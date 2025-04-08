import createDebugLogger from 'debug';
import {BLOB_UPDATE_OPERATIONS} from '../constants';

export default function (mongoOperator, amqpOperator, processHandler, config) {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugHandling = debug.extend('blobHandling');
  const debugRecordHandling = debug.extend('recordHandling');
  const {abortOnInvalidRecords, readFrom = 'blobContent', nextQueueStatus} = config;

  return startHandling;

  async function startHandling(blobId) {
    const recordPayloadQueuings = [];
    const blobUpdates = [];
    let hasFailed = false; // eslint-disable-line functional/no-let

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
              debugRecordHandling('Adding success record to blob');
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

    async function getEmitter(processHandler, readFrom, nextQueueStatus) {
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

    function getError(err) {
      return JSON.stringify(err.stack || err.message || err);
    }
  }
}
