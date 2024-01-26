import {v4 as uuid} from 'uuid';
import {BLOB_STATE} from '../constants';
import {closeAmqpResources} from '../utils';
import createDebugLogger from 'debug';
import {promisify} from 'util';

const setTimeoutPromise = promisify(setTimeout);

export default function (riApiClient, transformHandler, amqplib, config) {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugHandling = debug.extend('blobHandling');
  const debugRecordHandling = debug.extend('recordHandling');
  const {amqpUrl, abortOnInvalidRecords} = config;

  return startHandling;

  async function startHandling(blobId) {
    let connection; // eslint-disable-line functional/no-let
    let channel; // eslint-disable-line functional/no-let
    let hasFailed = false; // eslint-disable-line functional/no-let
    const pendingRecords = [];

    debugHandling(`Starting transformation for blob ${blobId}`);

    try {
      const {readStream} = await riApiClient.getBlobContent({id: blobId});

      connection = await amqplib.connect(amqpUrl);
      channel = await connection.createConfirmChannel();
      channel.assertQueue(blobId, {durable: true});

      const TransformEmitter = transformHandler(readStream);

      await new Promise((resolve, reject) => {
        TransformEmitter
          .on('end', () => {
            try {
              debugHandling(`Transformer has handled ${pendingRecords.length} record promises to line, waiting them to be resolved`);

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
          .on('record', payload => {
            pendingRecords.push(payload); // eslint-disable-line functional/immutable-data
          });
      });

      if (pendingRecords.length === 0) {
        debugHandling(`Setting blob state ${BLOB_STATE.DONE}...`);
        await riApiClient.updateState({id: blobId, state: BLOB_STATE.DONE});
        return;
      }

      await handleRecordResultsPump(pendingRecords);

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

    async function handleRecordResultsPump(recordResults) {
      if (abortOnInvalidRecords && hasFailed) {
        debugHandling('Not sending records to queue because some records failed and abortOnInvalidRecords is true');
        await riApiClient.setTransformationFailed({id: blobId, error: {message: 'Some records have failed'}});
        return;
      }

      const [recordResult, ...rest] = recordResults;

      if (recordResult === undefined) {
        debugHandling(`Transforming is done (All Promises resolved)`);
        debugHandling(`Setting blob state ${BLOB_STATE.TRANSFORMED}...`);
        await riApiClient.updateState({id: blobId, state: BLOB_STATE.TRANSFORMED});
        return;
      }

      await startProcessing(recordResult);
      await setTimeoutPromise(2);
      return handleRecordResultsPump(rest);


      async function startProcessing(payload) {
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
    }
  }
}
