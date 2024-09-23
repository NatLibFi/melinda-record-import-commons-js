import createDebugLogger from 'debug';
import {v4 as uuid} from 'uuid';
import {promisify} from 'util';

import {BLOB_STATE, BLOB_UPDATE_OPERATIONS} from '../constants';

export default function (mongoOperator, transformHandler, amqplib, config) {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugHandling = debug.extend('blobHandling');
  const debugRecordHandling = debug.extend('recordHandling');
  const {amqpUrl, abortOnInvalidRecords} = config;
  const setTimeoutPromise = promisify(setTimeout);

  return startHandling;

  async function startHandling(blobId) {
    let connection; // eslint-disable-line functional/no-let
    let channel; // eslint-disable-line functional/no-let
    const recordPayloads = [];

    debugHandling(`Starting transformation for blob ${blobId}`);

    try {
      const readStream = await mongoOperator.readBlobContent({id: blobId});

      connection = await amqplib.connect(amqpUrl);
      channel = await connection.createChannel();
      await channel.assertQueue(blobId, {durable: true});
      await channel.purgeQueue(blobId);

      const TransformEmitter = transformHandler(readStream);

      await new Promise((resolve, reject) => {
        TransformEmitter
          .on('end', async () => {
            debugHandling(`Transformer has handled all record to line. ${recordPayloads.length} records`);
            await setTimeoutPromise(50);
            debugHandling(`All records are transformed`);
            resolve(true);
          })
          .on('error', async err => {
            debugHandling('Transformation failed');
            await mongoOperator.updateBlob({
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.transformationFailed,
                error: getError(err)
              }
            });
            reject(err);
          })
          .on('cataloger', async cataloger => {
            debugHandling('Setting cataloger for blob');
            await mongoOperator.updateBlob({
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.setCataloger,
                cataloger
              }
            });
          })
          .on('notificationEmail', async notificationEmail => {
            debugHandling('Setting notification email for blob');
            await mongoOperator.updateBlob({
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.setNotificationEmail,
                notificationEmail
              }
            });
          })
          .on('record', payload => {
            recordPayloads.push(payload); // eslint-disable-line functional/immutable-data
          });
      });

      if (abortOnInvalidRecords && recordPayloads.some(recordPayload => recordPayload.failed === true)) {
        debugHandling('Not sending records to queue because some records failed and abortOnInvalidRecords is true');
        await mongoOperator.updateBlob({
          id: blobId,
          payload: {
            op: BLOB_UPDATE_OPERATIONS.transformationFailed,
            error: {message: 'Some records have failed'}
          }
        });
        connection.close();
        return;
      }

      debugHandling(`Abort on invalid records was false or all records were okay. Queuing records...`);
      await handleRecords(recordPayloads);

      debugHandling(`Setting blob state ${BLOB_STATE.TRANSFORMED}...`);
      await mongoOperator.updateBlob({
        id: blobId,
        payload: {
          op: BLOB_UPDATE_OPERATIONS.updateState,
          state: BLOB_STATE.TRANSFORMED
        }
      });
      debugHandling(`Closing AMQP resources!`);
      connection.close();
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
      connection.close();
      return;
    }

    function getError(err) {
      return JSON.stringify(err.stack || err.message || err);
    }

    async function handleRecords(recordPayloads) {
      const [recordPayload, ...rest] = recordPayloads;

      if (recordPayload === undefined) {
        debugHandling(`All records queued`);
        return;
      }

      await sendRecordToQueue(recordPayload);
      await updateBlob(recordPayload);
      return handleRecords(rest);

      async function sendRecordToQueue(recordPayload) {
        try {
          if (!recordPayload.failed) {
            const message = Buffer.from(JSON.stringify(recordPayload.record));
            await channel.sendToQueue(blobId, message, {persistent: true, messageId: uuid()});
            debugRecordHandling(`Record send to queue`);
            return;
          }

          debugRecordHandling(`Record failed, skip queuing!`);
          return;
        } catch (err) {
          throw new Error(`Error while sending record to queue: ${getError(err)}`);
        }
      }

      function updateBlob(payload) {
        try {
          if (payload.failed) {
            debugRecordHandling('Adding failed record to blob');
            return mongoOperator.updateBlob({
              id: blobId,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.transformedRecord,
                error: payload
              }
            });
          }

          debugRecordHandling('Adding succes record to blob');
          return mongoOperator.updateBlob({
            id: blobId,
            payload: {
              op: BLOB_UPDATE_OPERATIONS.transformedRecord
            }
          });
        } catch (err) {
          throw new Error(`Error while updating blob: ${getError(err)}`);
        }
      }
    }
  }
}
