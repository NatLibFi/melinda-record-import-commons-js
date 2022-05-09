/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* Shared modules for microservices of Melinda record batch import system
*
* Copyright (C) 2018-2022 University Of Helsinki (The National Library Of Finland)
*
* This file is part of melinda-record-import-commons
*
* melinda-record-import-commons program is free software: you can redistribute it and/or modify
* it under the terms of the GNU Affero General Public License as
* published by the Free Software Foundation, either version 3 of the
* License, or (at your option) any later version.
*
* melinda-record-import-commons is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU Affero General Public License for more details.
*
* You should have received a copy of the GNU Affero General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*
* @licend  The above is the entire license notice
* for the JavaScript code in this file.
*
*/

import {v4 as uuid} from 'uuid';
import {BLOB_STATE} from '../constants';
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

    try {
      const {readStream} = await riApiClient.getBlobContent({id: blobId});
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
            pendingPromises.push(startProcessing(payload)); // eslint-disable-line functional/immutable-data

            async function startProcessing(payload) {
              await sendRecordToQueue(payload);
              await updateBlob(payload);
              return;

              async function sendRecordToQueue(payload) {
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
          });
      });
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
  }
}
