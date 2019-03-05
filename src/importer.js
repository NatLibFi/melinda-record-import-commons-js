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

import amqp from 'amqplib';
import {promisify} from 'util';
import {checkEnv as checkEnvShared, createLogger} from './common';
import {createApiClient} from './api-client';
import {RECORD_IMPORT_STATE} from './constants';

const MAX_MESSAGE_TRIES = process.env.MAX_MESSAGE_TRIES || 3;
const MESSAGE_WAIT_TIME = process.env.MESSAGE_WAIT_TIME || 3000;

const MANDATORY_ENV_VARIABLES = [
	'API_URL',
	'API_USERNAME',
	'API_PASSWORD',
	'PROFILE_ID',
	'AMQP_URL'
];

export function checkEnv() {
	checkEnvShared(MANDATORY_ENV_VARIABLES);
}

export async function startImport({callback, blobId, profile, apiURL, apiUsername, apiPassword, amqpURL}) {
	const logger = createLogger();
	const setTimeoutPromise = promisify(setTimeout);
	const ApiClient = createApiClient({url: apiURL, username: apiUsername, password: apiPassword});
	const connection = await amqp.connect(amqpURL);
	const channel = await connection.createChannel();

	channel.assertQueue(profile, {durable: true});

	logger.info(`Ready to consume messages from queue ${profile}`);
	await consume();

	async function consume(tries = 0) {
		const message = await channel.get(profile);

		if (message && message.fields.routingKey === blobId) {
			logger.debug('Record received');

			const metadata = await ApiClient.getBlobMetadata(blobId);

			if (metadata.state === RECORD_IMPORT_STATE.aborted) {
				logger.info('Blob state is set to ABORTED. Ditching message');
				await channel.nack(message, false, false);
				return consume();
			}

			let importResult;

			try {
				importResult = await callback(message);
			} catch (err) {
				await channel.nack(message, false, true);
				throw err;
			}

			await channel.ack(message);
			await ApiClient.setRecordProcessed({blobId, ...importResult});

			return consume();
		}

		if (tries < MAX_MESSAGE_TRIES) {
			await setTimeoutPromise(MESSAGE_WAIT_TIME);
			return consume(tries + 1);
		}

		logger.info('No more messages in queue');
	}
}
