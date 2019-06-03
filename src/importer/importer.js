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
import {Utils} from '@natlibfi/melinda-commons';
import {createApiClient} from '../api-client';
import {startHealthCheckService} from '../common';
import {RECORD_IMPORT_STATE} from '../constants';

const {createLogger} = Utils;

export default async function (importCallback) {
	const {AMQP_URL, API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT, BLOB_ID, HEALTH_CHECK_PORT} = await import('./config');
	const logger = createLogger();
	const stopHealthCheckService = startHealthCheckService(HEALTH_CHECK_PORT);

	process.on('SIGINT', () => {
		stopHealthCheckService();
		process.exit(1);
	});

	try {
		await startImport();
		stopHealthCheckService();
		process.exit();
	} catch (err) {
		stopHealthCheckService();
		logger.log('error', err instanceof Error ? err.stack : err);
		process.exit(1);
	}

	async function startImport() {
		let connection;
		let channel;

		connection = await amqplib.connect(AMQP_URL);
		channel = await connection.createChannel();

		const ApiClient = createApiClient({url: API_URL, username: API_USERNAME, password: API_PASSWORD, userAgent: API_CLIENT_USER_AGENT});

		logger.log('info', `Starting consuming records of blob ${BLOB_ID}`);

		try {
			await consume();
			logger.log('info', 'Processed all messages.');
		} finally {
			if (channel) {
				await channel.close();
			}

			if (connection) {
				await connection.close();
			}
		}

		async function consume() {
			const message = await channel.get(BLOB_ID);

			if (message) {
				logger.log('debug', 'Record received');

				const metadata = await ApiClient.getBlobMetadata({id: BLOB_ID});

				if (metadata.state === RECORD_IMPORT_STATE.ABORTED) {
					logger.log('info', 'Blob state is set to ABORTED. Ditching message');
					await channel.nack(message, false, false);
					return consume();
				}

				try {
					const importResult = await importCallback(message);
					await ApiClient.setRecordProcessed({blobId: BLOB_ID, ...importResult});
					await channel.ack(message);
				} catch (err) {
					await channel.nack(message);
					throw err;
				}

				logger.log('debug', 'Set record as processed');
				return consume();
			}
		}
	}
}
