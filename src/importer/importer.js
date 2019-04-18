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
import {promisify} from 'util';
import {Utils} from '@natlibfi/melinda-commons';
import {createApiClient} from '../api-client';
import {startHealthCheckService} from '../common';
import {RECORD_IMPORT_STATE} from '../constants';

const {createLogger} = Utils;

export default async function (importCallback) {
	const {AMQP_URL, API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT, BLOB_ID, PROFILE_ID, HEALTH_CHECK_PORT, MAX_MESSAGE_TRIES, MESSAGE_WAIT_TIME} = await import('./config');
	const Logger = createLogger();
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
		Logger.error(err instanceof Error ? err.stack : err);
		process.exit(1);
	}

	async function startImport() {
		const setTimeoutPromise = promisify(setTimeout);
		const ApiClient = createApiClient({url: API_URL, username: API_USERNAME, password: API_PASSWORD, userAgent: API_CLIENT_USER_AGENT});
		const connection = await amqplib.connect(AMQP_URL);
		const channel = await connection.createChannel();

		channel.assertQueue(PROFILE_ID, {durable: true});

		Logger.info(`Ready to consume records of blob ${BLOB_ID} from queue ${PROFILE_ID}`);
		await consume();

		async function consume(tries = 0) {
			const message = await channel.get(PROFILE_ID);

			if (message && message.fields.routingKey === BLOB_ID) {
				Logger.debug('Record received');

				const metadata = await ApiClient.getBlobMetadata({id: BLOB_ID});

				if (metadata.state === RECORD_IMPORT_STATE.ABORTED) {
					Logger.info('Blob state is set to ABORTED. Ditching message');
					await channel.nack(message, false, false);
					return consume();
				}

				let importResult;

				try {
					importResult = await importCallback(message);
				} catch (err) {
					await channel.nack(message, false, true);
					throw err;
				}

				await channel.ack(message);
				await ApiClient.setRecordProcessed({blobId: BLOB_ID, ...importResult});
				Logger.log('debug', 'Set record as processed');

				return consume();
			}

			if (tries < MAX_MESSAGE_TRIES) {
				await setTimeoutPromise(MESSAGE_WAIT_TIME);
				return consume(tries + 1);
			}

			Logger.info('No more messages in queue');
		}
	}
}
