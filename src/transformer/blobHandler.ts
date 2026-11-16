import createDebugLogger from 'debug';
import {BLOB_STATE, BLOB_UPDATE_OPERATIONS} from '../constants.ts';

import type {AmqpOperator} from '../amqp.ts';
import type {MongoBlobsOperator} from '../mongoBlobs.ts';
import type {EventEmitter, Readable} from 'node:stream';

export interface BlobHandlerConfig {
  abortOnInvalidRecords?: boolean;
  readFrom?: 'blobContent' | Readable | ReadableStream;
  nextQueueStatus?: keyof typeof BLOB_STATE;
  /** Delay in ms before process.exit(1) on infrastructure errors (default 3000, lets logs flush) */
  infraErrorExitDelayMs?: number;
}

export interface RecordPayload {
  failed: boolean;
  record: string;
  error: string | any;
  incNumberOfRecords: boolean
}

export type ProcessHandler = (source: Readable | ReadableStream) => Promise<EventEmitter>;

export type BlobHandler = (blobId: string) => Promise<void>;

/**
 * Internal sentinel: a user transform failure that has already been
 * marked on the blob (transformationFailed). The outer catch treats this
 * as handled and does NOT exit the process.
 */
class HandledTransformError extends Error {}

export default function (
  mongoOperator: MongoBlobsOperator,
  amqpOperator: AmqpOperator,
  processHandler: ProcessHandler,
  config: BlobHandlerConfig
): BlobHandler {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugHandling = debug.extend('blobHandling');
  const debugRecordHandling = debug.extend('recordHandling');
  const {
    abortOnInvalidRecords,
    readFrom = 'blobContent',
    nextQueueStatus,
    infraErrorExitDelayMs = 3000
  } = config;

  if (nextQueueStatus === undefined) {
    throw new Error('nextQueueStatus is required');
  }
  const nextStatus: keyof typeof BLOB_STATE = nextQueueStatus;

  return startHandling;

  async function startHandling(blobId: string): Promise<void> {
    const recordPayloadQueuings: Promise<void | boolean>[] = [];
    const blobUpdates: Promise<void>[] = [];
    let hasFailed = false;
    let settled = false;

    debugHandling(`Starting process for blob ${blobId}`);

    try {
      const handlerEmitter = await getEmitter(readFrom, nextStatus);

      await new Promise((resolve, reject) => {
        handlerEmitter
          .on('end', async () => {
            if (settled) {
              return;
            }
            settled = true;
            debugHandling(`Process has collected all records. ${recordPayloadQueuings.length} records`);
            try {
              await Promise.all(recordPayloadQueuings);
              debugHandling(`All records are Processed`);
              await Promise.all(blobUpdates);
              debugHandling(`All blob updates are Processed`);
              resolve(true);
            } catch (err) {
              failProcess(err);
            }
          })
          .on('error', async err => {
            if (settled) {
              return;
            }
            settled = true;
            debugHandling('Process has failed');
            try {
              await mongoOperator.updateBlob({
                id: blobId,
                payload: {
                  op: BLOB_UPDATE_OPERATIONS.transformationFailed,
                  error: getError(err)
                }
              });
            } catch (updateErr) {
              // Infrastructure error while marking the blob as failed
              failProcess(updateErr);
              return;
            }
            // Sentinel: blob is already marked as failed, treat as handled in the outer catch
            reject(new HandledTransformError(err));
          })
          .on('cataloger', cataloger => {
            debugHandling('Setting cataloger for blob');
            track(blobUpdates, mongoOperator.updateBlob({
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.setCataloger,
                cataloger
              }
            }));
          })
          .on('notificationEmail', notificationEmail => {
            debugHandling('Setting notification email for blob');
            track(blobUpdates, mongoOperator.updateBlob({
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
              track(recordPayloadQueuings, amqpOperator.sendToQueue({
                blobId,
                status: nextStatus,
                data: record
              }));
              //recordPayloads.push(payload);
              debugRecordHandling('Adding success record to blob');
              track(blobUpdates, mongoOperator.updateBlob({
                id: blobId,
                payload: {
                  op: BLOB_UPDATE_OPERATIONS.transformedRecord
                }
              }));
              return;
            }
            debugRecordHandling(`Record failed, skip queuing!`);
            debugRecordHandling('Adding failed record to blob');
            track(blobUpdates, mongoOperator.updateBlob({
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
        await amqpOperator.purgeQueue({blobId, status: nextStatus});
        await mongoOperator.updateBlob({
          id: blobId,
          payload: {
            op: BLOB_UPDATE_OPERATIONS.transformationFailed,
            error: {message: 'Abort on record failure'}
          }
        });

        return;
      }

      debug(`Setting blob state ${nextStatus}...`);
      await mongoOperator.updateBlob({
        id: blobId,
        payload: {
          op: BLOB_UPDATE_OPERATIONS.updateState,
          state: nextStatus
        }
      });

      return;
    } catch (err) {
      if (err instanceof HandledTransformError) {
        debugHandling(`Transform failed for blob ${blobId}, blob marked as TRANSFORMATION_FAILED, continuing`);
        return;
      }
      failProcess(err);
    }

    async function getEmitter(
      readFrom: 'blobContent' | Readable | ReadableStream,
      nextQueueStatus: keyof typeof BLOB_STATE
    ): Promise<EventEmitter> {
      debugHandling(`Preparing next queue: ${blobId}.${nextQueueStatus}`);
      await amqpOperator.purgeQueue({blobId, status: nextQueueStatus});

      if (readFrom === 'blobContent') {
        debugHandling(`Streaming blob content: ${blobId}`);
        const readStream = await mongoOperator.readBlobContent({id: blobId});
        return callProcessHandler(readStream);
      }

      debugHandling(`Passing read source ${readFrom} to process handler`);
      return callProcessHandler(readFrom);
    }

    async function callProcessHandler(source: Readable | ReadableStream): Promise<EventEmitter> {
      let result: unknown;
      try {
        result = processHandler(source);
      } catch (err) {
        return markTransformFailed(err);
      }
      if (result && typeof (result as {then?: unknown}).then === 'function') {
        try {
          return await result as EventEmitter;
        } catch (err) {
          return markTransformFailed(err);
        }
      }
      return result as EventEmitter;
    }

    async function markTransformFailed(err: unknown): Promise<never> {
      // User error from the transform handler (sync throw or async rejection):
      // mark blob as failed and keep running
      debugHandling('Process handler failed, marking blob as TRANSFORMATION_FAILED');
      await mongoOperator.updateBlob({
        id: blobId,
        payload: {
          op: BLOB_UPDATE_OPERATIONS.transformationFailed,
          error: getError(err)
        }
      });
      throw new HandledTransformError(getError(err));
    }

    function getError(err: unknown): string {
      if (err instanceof Error) {
        return JSON.stringify(err.stack || err.message || err);
      }
      return JSON.stringify(err);
    }

    function track<T>(promises: Promise<T>[], promise: Promise<T>): void {
      // Guard: rejections are settled later by Promise.all in the 'end' handler; without
      // this, a rejection before that point would be an unhandled rejection. Attaching a
      // separate .catch handler does not consume the rejection for Promise.all.
      promise.catch(() => undefined);
      promises.push(promise);
    }

    function failProcess(err: unknown): void {
      debugHandling(`Infrastructure error while handling blob ${blobId} — exiting so the process restarts: ${getError(err)}`);
      // Delayed exit gives time for logs to flush; unref so tests don't hang
      setTimeout(() => process.exit(1), infraErrorExitDelayMs).unref();
    }
  }
}
