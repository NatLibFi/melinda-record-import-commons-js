import createDebugLogger from 'debug';
import {BLOB_STATE, BLOB_UPDATE_OPERATIONS} from '../constants.ts';

import type {AmqpOperator} from '../amqp.ts';
import type {MongoBlobsOperator} from '../mongoBlobs.ts';
import type {EventEmitter, Readable} from 'node:stream';

export interface BlobHandlerConfig {
  abortOnInvalidRecords?: boolean;
  readFrom?: 'blobContent' | Readable | ReadableStream;
  nextQueueStatus?: keyof typeof BLOB_STATE;
}

export interface RecordPayload {
  failed: boolean;
  record: string;
  error: string | any;
  incNumberOfRecords: boolean
}

export type ProcessHandler = (source: Readable | ReadableStream) => Promise<EventEmitter>;

export type BlobHandler = (blobId: string) => Promise<void>;

export default function (
  mongoOperator: MongoBlobsOperator,
  amqpOperator: AmqpOperator,
  processHandler,
  config
): BlobHandler {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugHandling = debug.extend('blobHandling');
  const debugRecordHandling = debug.extend('recordHandling');
  const {abortOnInvalidRecords, readFrom = 'blobContent', nextQueueStatus} = config;

  return startHandling;

  async function startHandling(blobId: string): Promise<void> {
    const recordPayloadQueuings: Promise<void | boolean>[] = [];
    const blobUpdates: Promise<void>[] = [];
    let hasFailed = false;

    debugHandling(`Starting process for blob ${blobId}`);

    try {
      const handlerEmitter = await getEmitter(processHandler, readFrom, nextQueueStatus);

      await new Promise((resolve, reject) => {
        handlerEmitter
          .on('end', async () => {
            debugHandling(`Process has collected all records. ${recordPayloadQueuings.length} records`);
            await Promise.all(recordPayloadQueuings);
            debugHandling(`All records are Processed`);
            await Promise.all(blobUpdates);
            debugHandling(`All blob updates are Processed`);
            resolve(true);
          })
          .on('error', async err => {
            debugHandling('Process has failed');
            await mongoOperator.updateBlob({
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.transformationFailed,
                error: getError(err)
              }
            });
            reject(err);
          })
          .on('cataloger', cataloger => {
            debugHandling('Setting cataloger for blob');
            blobUpdates.push(mongoOperator.updateBlob({
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.setCataloger,
                cataloger
              }
            }));
          })
          .on('notificationEmail', notificationEmail => {
            debugHandling('Setting notification email for blob');
            blobUpdates.push(mongoOperator.updateBlob({
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.setNotificationEmail,
                notificationEmail
              }
            }));
          })
          .on('record', (recordPayload: RecordPayload) => {
            const {failed, error, incNumberOfRecords, record} = recordPayload;
            if (!failed) {
              debugRecordHandling(`Sending record to queue`);
              recordPayloadQueuings.push(amqpOperator.sendToQueue({
                blobId,
                status: nextQueueStatus,
                data: record
              }));
              //recordPayloads.push(payload);
              debugRecordHandling('Adding success record to blob');
              blobUpdates.push(mongoOperator.updateBlob({
                id: blobId,
                payload: {
                  op: BLOB_UPDATE_OPERATIONS.transformedRecord
                }
              }));
              return;
            }
            debugRecordHandling(`Record failed, skip queuing!`);
            debugRecordHandling('Adding failed record to blob');
            blobUpdates.push(mongoOperator.updateBlob({
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.transformedRecord,
                error: {error, record},
                incNumberOfRecords
              }
            }));
            // Setting fail check value trigger
            hasFailed = true;
            return;
          });
      });

      if (abortOnInvalidRecords && hasFailed) {
        debug('Purge records from queue because some records failed and abortOnInvalidRecords is true');
        await amqpOperator.purgeQueue({blobId, status: nextQueueStatus});
        await mongoOperator.updateBlob({
          id: blobId,
          payload: {
            op: BLOB_UPDATE_OPERATIONS.transformationFailed,
            error: {message: 'Abort on record failure'}
          }
        });

        return;
      }

      debug(`Setting blob state ${nextQueueStatus}...`);
      await mongoOperator.updateBlob({
        id: blobId,
        payload: {
          op: BLOB_UPDATE_OPERATIONS.updateState,
          state: nextQueueStatus
        }
      });

      return;
    } catch (err) {
      const error = getError(err);
      debugHandling(`Failed transforming blob: ${error}`);
      await mongoOperator.updateBlob({
        id: blobId,
        payload: {
          op: BLOB_UPDATE_OPERATIONS.transformationFailed,
          error
        }
      });

      return;
    }

    async function getEmitter(
      processHandler: ProcessHandler,
      readFrom: 'blobContent' | Readable | ReadableStream,
      nextQueueStatus: keyof typeof BLOB_STATE
    ): Promise<EventEmitter> {
      debugHandling(`Preparing next queue: ${blobId}.${nextQueueStatus}`);
      await amqpOperator.purgeQueue({blobId, status: nextQueueStatus});

      if (readFrom === 'blobContent') {
        debugHandling(`Streaming blob content: ${blobId}`);
        const readStream = await mongoOperator.readBlobContent({id: blobId});
        return processHandler(readStream);
      }

      debugHandling(`Passing read source ${readFrom} to process handler`);
      return processHandler(readFrom);
    }

    function getError(err): string {
      return JSON.stringify(err.stack || err.message || err);
    }
  }
}
