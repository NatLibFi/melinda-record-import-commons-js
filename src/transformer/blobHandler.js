import createDebugLogger from 'debug';
import {v4 as uuid} from 'uuid';
import {promisify} from 'util';

import {BLOB_STATE} from '../constants';
import {closeAmqpResources} from '../utils';

export default function (riApiClient, transformHandler, amqplib, config) {
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
      const {readStream} = await riApiClient.getBlobContent({id: blobId});

      connection = await amqplib.connect(amqpUrl);
      channel = await connection.createConfirmChannel();
      channel.assertQueue(blobId, {durable: true});

      const TransformEmitter = transformHandler(readStream);

      await new Promise((resolve, reject) => {
        TransformEmitter
          .on('end', async () => {
            try {
              debugHandling(`Transformer has handled all record to line. ${recordPayloads.length} records`);
              await setTimeoutPromise(50);
              return resolve(true);
            } catch (err) {
              reject(err);
            }

            resolve(true);
          })
          .on('error', async err => {
            debugHandling('Transformation failed');
            await riApiClient.setTransformationFailed({id: blobId, error: getError(err)});
            reject(err);
          })
          .on('cataloger', async cataloger => {
            debugHandling('Setting cataloger for blob');
            await riApiClient.setCataloger({id: blobId, cataloger});
          })
          .on('notificationEmail', async notificationEmail => {
            debugHandling('Setting notification email for blob');
            await riApiClient.setNotificationEmail({id: blobId, notificationEmail});
          })
          .on('record', payload => {
            recordPayloads.push(payload); // eslint-disable-line functional/immutable-data
          });
      });


      if (abortOnInvalidRecords && recordPayloads.some(recordPayload => recordPayload.failed === true)) {
        debugHandling('Not sending records to queue because some records failed and abortOnInvalidRecords is true');
        await riApiClient.setTransformationFailed({id: blobId, error: {message: 'Some records have failed'}});
        return;
      }

      const pendingQueuings = recordPayloads.map(recordPayload => handleRecord(recordPayload));
      await Promise.all(pendingQueuings);

      debugHandling(`Transforming is done (All Promises resolved)`);
      debugHandling(`Setting blob state ${BLOB_STATE.TRANSFORMED}...`);
      await riApiClient.updateState({id: blobId, state: BLOB_STATE.TRANSFORMED});
    } catch (err) {
      const error = getError(err);
      debugHandling(`Failed transforming blob: ${error}`);
      await riApiClient.setTransformationFailed({id: blobId, error});
    } finally {
      await closeAmqpResources({connection, channel});
    }

    function getError(err) {
      return JSON.stringify(err.stack || err.message || err);
    }

    async function handleRecord(payload) {
      await sendRecordToQueue(payload);
      await updateBlob(payload);
      return;

      async function sendRecordToQueue(payload) {
        if (!payload.failed) {
          try {
            const message = Buffer.from(JSON.stringify(payload.record));
            await new Promise((resolve, reject) => {
              channel.sendToQueue(blobId, message, {persistent: true, messageId: uuid()}, (err) => {
                if (err !== null) { // eslint-disable-line functional/no-conditional-statements
                  reject(err);
                }

                debugHandling(`Record send to queue`);
                resolve();
              });
            });
          } catch (err) {
            throw new Error(`Error while sending record to queue: ${getError(err)}`);
          }
          return;
        }
      }

      function updateBlob(payload) {
        try {
          if (payload.failed) {
            debugRecordHandling('Adding failed record to blob');
            return riApiClient.transformedRecord({
              id: blobId,
              error: payload
            });
          }

          debugRecordHandling('Adding succes record to blob');
          return riApiClient.transformedRecord({
            id: blobId
          });
        } catch (err) {
          throw new Error(`Error while updating blob: ${getError(err)}`);
        }
      }
    }
  }
}
