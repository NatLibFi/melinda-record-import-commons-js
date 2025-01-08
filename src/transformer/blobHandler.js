import createDebugLogger from 'debug';

import createAmqpOperator from '../amqp';
import {BLOB_UPDATE_OPERATIONS} from '../constants';

export default async function (mongoOperator, processHandler, amqplib, config) {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugHandling = debug.extend('blobHandling');
  const debugRecordHandling = debug.extend('recordHandling');
  const {amqpUrl, abortOnInvalidRecords, readFrom = 'blobContent', nextQueueStatus} = config;
  const amqpOperator = await createAmqpOperator(amqplib, amqpUrl);

  return startHandling;

  async function startHandling(blobId, status) {
    const recordPayloadQueuings = [];
    const blobUpdates = [];
    let hasFailed = false; // eslint-disable-line functional/no-let

    debugHandling(`Starting process for blob ${blobId}`);

    try {
      const HandlerEmitter = getEmitter(processHandler, readFrom);

      await new Promise((resolve, reject) => {
        HandlerEmitter
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
            blobUpdates.push(mongoOperator.updateBlob({ // eslint-disable-line functional/immutable-data
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.setCataloger,
                cataloger
              }
            }));
          })
          .on('notificationEmail', notificationEmail => {
            debugHandling('Setting notification email for blob');
            blobUpdates.push(mongoOperator.updateBlob({ // eslint-disable-line functional/immutable-data
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.setNotificationEmail,
                notificationEmail
              }
            }));
          })
          .on('record', recordPayload => {
            if (!recordPayload.failed) {
              debugRecordHandling(`Sending record to queue`);
              recordPayloadQueuings.push(amqpOperator.sendToQueue({ // eslint-disable-line functional/immutable-data
                blobId,
                status: nextQueueStatus,
                data: recordPayload.record
              }));
              //recordPayloads.push(payload); // eslint-disable-line functional/immutable-data
              debugRecordHandling('Adding succes record to blob');
              blobUpdates.push(mongoOperator.updateBlob({ // eslint-disable-line functional/immutable-data
                id: blobId,
                payload: {
                  op: BLOB_UPDATE_OPERATIONS.transformedRecord
                }
              }));
              return;
            }
            debugRecordHandling(`Record failed, skip queuing!`);
            debugRecordHandling('Adding failed record to blob');
            blobUpdates.push(mongoOperator.updateBlob({ // eslint-disable-line functional/immutable-data
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.transformedRecord,
                error: recordPayload
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

        debug(`Closing AMQP resources!`);
        await amqpOperator.closeChannel();
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

      debug(`Closing AMQP resources!`);
      await amqpOperator.closeConnection();
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

      debugHandling(`Closing AMQP resources!`);
      await amqpOperator.closeConnection();
      return;
    }

    async function getEmitter(processHandler, readFrom) {
      if (readFrom === 'blobContent') {
        await amqpOperator.countQueue({blobId, status});
        await amqpOperator.purgeQueue({blobId, status});

        const readStream = mongoOperator.readBlobContent({id: blobId});
        return processHandler(readStream);
      }

      return processHandler(readFrom);
    }

    function getError(err) {
      return JSON.stringify(err.stack || err.message || err);
    }
  }
}
