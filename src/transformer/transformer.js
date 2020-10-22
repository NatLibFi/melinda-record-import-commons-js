/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* Shared modules for microservices of Melinda record batch import system
*
* Copyright (C) 2018-2019 University Of Helsinki (The National Library Of Finland)
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

import amqplib from 'amqplib';
import uuid from 'uuid/v4';
import {createLogger} from '@natlibfi/melinda-backend-commons';
import {registerSignalHandlers, startHealthCheckService, closeResources} from '../common';
import {createApiClient} from '../api-client';
import {BLOB_STATE} from '../constants';

export default async function (transformCallback) {
  const {AMQP_URL, API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT, BLOB_ID, ABORT_ON_INVALID_RECORDS, HEALTH_CHECK_PORT} = await import('./config');
  const logger = createLogger();
  const stopHealthCheckService = startHealthCheckService();

  registerSignalHandlers({stopHealthCheckService});

  try {
    await startTransformation(HEALTH_CHECK_PORT);
    stopHealthCheckService();
    process.exit(); // eslint-disable-line no-process-exit
  } catch (err) {
    stopHealthCheckService();
    logger.log('error', err instanceof Error ? err.stack : err);
    process.exit(1); // eslint-disable-line no-process-exit
  }

  async function startTransformation() {
    let connection; // eslint-disable-line functional/no-let
    let channel; // eslint-disable-line functional/no-let

    logger.log('info', `Starting transformation for blob ${BLOB_ID}`);

    const ApiClient = createApiClient({url: API_URL, username: API_USERNAME, password: API_PASSWORD, userAgent: API_CLIENT_USER_AGENT});
    const {readStream} = await ApiClient.getBlobContent({id: BLOB_ID});

    try {
      let hasFailed = false; // eslint-disable-line functional/no-let

      connection = await amqplib.connect(AMQP_URL);
      channel = await connection.createConfirmChannel();

      const TransformEmitter = transformCallback(readStream, {});
      const pendingPromises = [];

      await new Promise((resolve, reject) => {
        TransformEmitter
          .on('end', async (count = 0) => {
            logger.log('debug', `Transformer has handled ${pendingPromises.length / 2} / ${count} record promises to line, waiting them to be resolved`);

            try {
              await Promise.all(pendingPromises);
              logger.log('debug', `Transforming is done (${pendingPromises.length / 2} / ${count} Promises resolved)`);

              if (ABORT_ON_INVALID_RECORDS && hasFailed) {
                logger.log('info', 'Not sending records to queue because some records failed and ABORT_ON_INVALID_RECORDS is true');
                await ApiClient.setTransformationFailed({id: BLOB_ID, error: {message: 'Some records have failed'}});
                return;
              }

              logger.log('info', `Setting blob state ${BLOB_STATE.TRANSFORMED}¸¸`);
              await ApiClient.updateState({id: BLOB_ID, state: BLOB_STATE.TRANSFORMED});
            } catch (err) {
              reject(err);
            }

            resolve(true);
          })
          .on('error', async err => {
            logger.log('info', 'Transformation failed');
            await ApiClient.setTransformationFailed({id: BLOB_ID, error: getError(err)});
            reject(err);
          })
          .on('record', payload => {
            pendingPromises.push(sendRecordToQueue()); // eslint-disable-line functional/immutable-data
            pendingPromises.push(updateBlob()); // eslint-disable-line functional/immutable-data

            async function sendRecordToQueue() {
              if (!payload.failed) {
                if (ABORT_ON_INVALID_RECORDS && !hasFailed || !ABORT_ON_INVALID_RECORDS) { // eslint-disable-line functional/no-conditional-statement, no-mixed-operators
                  try {
                    channel.assertQueue(BLOB_ID, {durable: true});
                    const message = Buffer.from(JSON.stringify(payload.record));
                    await channel.sendToQueue(BLOB_ID, message, {persistent: true, messageId: uuid()}, (err, ok) => {
                      if (err !== null) { // eslint-disable-line functional/no-conditional-statement
                        throw new Error(`Error on record sending confirmation: ${getError(err)}`);
                      }

                      logger.log('debug', `Record send to queue ${ok}`);
                    });
                  } catch (err) {
                    throw new Error(`Error while sending record to queue: ${getError(err)}`);
                  }
                }
              }
            }

            async function updateBlob() {
              try {
                if (payload.failed) {
                  hasFailed = true;
                  await ApiClient.transformedRecord({
                    id: BLOB_ID,
                    error: payload
                  });

                  return;
                }

                await ApiClient.transformedRecord({
                  id: BLOB_ID
                });

                return;
              } catch (err) {
                throw new Error(`Error while updating blob: ${getError(err)}`);
              }
            }
          });
      });
    } catch (err) {
      const error = getError(err);
      logger.log('error', `Failed transforming blob: ${error}`);
      await ApiClient.setTransformationFailed({id: BLOB_ID, error});
    } finally {
      await closeResources();
    }

    function getError(err) {
      return JSON.stringify(err.stack || err.message || err);
    }
  }
}
