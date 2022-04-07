import {v4 as uuid} from 'uuid';
import {BLOB_STATE} from '../common';
import {closeAmqpResources} from '../utils';
import createDebugLogger from 'debug';

export default function(riApiClient, transformHandler, amqplib, config) {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugHandling = debug.extend('blobHandling');
  const debugRecordHandling = debug.extend('recordHandling');
  const {amqpUrl, abortOnInvalidRecords} = config;

  return startHandling;

  async function startHandling(blobId) {
    let connection; // eslint-disable-line functional/no-let
    let channel; // eslint-disable-line functional/no-let

    debugHandling(`Starting transformation for blob ${blobId}`);

    const {readStream} = await riApiClient.getBlobContent({id: blobId});

    try {
      let hasFailed = false; // eslint-disable-line functional/no-let

      connection = await amqplib.connect(amqpUrl);
      channel = await connection.createConfirmChannel();
      channel.assertQueue(blobId, {durable: true});

      const TransformEmitter = transformHandler(readStream);
      const pendingPromises = [];

      await new Promise((resolve, reject) => {
        TransformEmitter
          .on('end', async (count = 0) => {
            debugHandling(`Transformer has handled ${pendingPromises.length} / ${count} record promises to line, waiting them to be resolved`);

            if (count === 0 && pendingPromises.length === 0) {
              debugHandling(`Setting blob state ${BLOB_STATE.DONE}...`);
              await riApiClient.updateState({id: blobId, state: BLOB_STATE.DONE});
              return;
            }

            try {
              await Promise.all(pendingPromises);
              debugHandling(`Transforming is done (${pendingPromises.length} / ${count} Promises resolved)`);

              if (abortOnInvalidRecords && hasFailed) {
                debugHandling('Not sending records to queue because some records failed and abortOnInvalidRecords is true');
                await riApiClient.setTransformationFailed({id: blobId, error: {message: 'Some records have failed'}});
                return;
              }


              debugHandling(`Setting blob state ${BLOB_STATE.TRANSFORMED}...`);
              await riApiClient.updateState({id: blobId, state: BLOB_STATE.TRANSFORMED});
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
          .on('record', payload => {
            pendingPromises.push(startProcessing()); // eslint-disable-line functional/immutable-data

            async function startProcessing() {
              await sendRecordToQueue();
              await updateBlob();
              return;

              async function sendRecordToQueue() {
                if (!payload.failed) {
                  if (abortOnInvalidRecords && !hasFailed || !abortOnInvalidRecords) { // eslint-disable-line functional/no-conditional-statement, no-mixed-operators
                    try {
                      const message = Buffer.from(JSON.stringify(payload.record));
                      await new Promise((resolve, reject) => {
                        channel.sendToQueue(blobId, message, {persistent: true, messageId: uuid()}, (err) => {
                          if (err !== null) { // eslint-disable-line functional/no-conditional-statement
                            reject(err);
                          }

                          debugHandling(`Record send to queue`);
                          resolve();
                        });
                      });
                    } catch (err) {
                      throw new Error(`Error while sending record to queue: ${getError(err)}`);
                    }
                  }
                }
              }

              function updateBlob() {
                try {
                  if (payload.failed) {
                    debugRecordHandling('Adding failed record to blob');
                    hasFailed = true;
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
          });
      });
    } catch (err) {
      const error = getError(err);
      error(`Failed transforming blob: ${error}`);
      await riApiClient.setTransformationFailed({id: blobId, error});
    } finally {
      await closeAmqpResources({connection, channel});
    }

    function getError(err) {
      return JSON.stringify(err.stack || err.message || err);
    }
  }
}
