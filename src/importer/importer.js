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
import {createLogger} from '@natlibfi/melinda-backend-commons';
import {createApiClient} from '../api-client';
import {startHealthCheckService, closeResources} from '../common';
import {RECORD_IMPORT_STATE} from '../constants';

export default async function (importCallback) {
  const {AMQP_URL, API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT, BLOB_ID, HEALTH_CHECK_PORT} = await import('./config');
  const logger = createLogger();
  const stopHealthCheckService = startHealthCheckService(HEALTH_CHECK_PORT);

  process.on('SIGINT', () => {
    stopHealthCheckService();
    process.exit(1); // eslint-disable-line no-process-exit
  });

  try {
    await startImport();
    stopHealthCheckService();
    process.exit(); // eslint-disable-line no-process-exit
  } catch (err) {
    stopHealthCheckService();
    logger.error(err instanceof Error ? err.stack : err);
    process.exit(1); // eslint-disable-line no-process-exit
  }

  async function startImport() {
    let connection; // eslint-disable-line functional/no-let
    let channel; // eslint-disable-line functional/no-let

    connection = await amqplib.connect(AMQP_URL); // eslint-disable-line prefer-const
    channel = await connection.createChannel(); // eslint-disable-line prefer-const

    const ApiClient = createApiClient({url: API_URL, username: API_USERNAME, password: API_PASSWORD, userAgent: API_CLIENT_USER_AGENT});

    const {messageCount} = await channel.assertQueue(BLOB_ID, {durable: true});
    logger.info(`Starting consuming records of blob ${BLOB_ID}, ${messageCount} records in queue.`);

    try {
      if (messageCount === 0) {
        await ApiClient.setAborted({id: BLOB_ID});
        return;
      }

      await consume();
      logger.info('Processed all messages.');
    } finally {
      await closeResources({connection, channel});
    }

    async function consume() {
      const message = await channel.get(BLOB_ID);

      if (message) {
        logger.debug('Record received');

        const metadata = await ApiClient.getBlobMetadata({id: BLOB_ID});

        if (metadata.state === RECORD_IMPORT_STATE.ABORTED) {
          logger.info('Blob state is set to ABORTED. Ditching message');
          await channel.nack(message, false, false);
          return consume();
        }

        try {
          const importResult = await importCallback(message);
          logger.debug(`Ìmport result: ${JSON.stringify(importResult)}`);
          await ApiClient.setRecordProcessed({blobId: BLOB_ID, ...importResult});
          await channel.ack(message);
        } catch (err) {
          await channel.nack(message);
          throw err;
        }

        logger.debug('Set record as processed');
        return consume();
      }
    }
  }
}
