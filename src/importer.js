/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* Shared modules for microservices of Melinda record batch import system
*
* Copyright (C) 2018 University Of Helsinki (The National Library Of Finland)
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
import fetch from 'node-fetch';
import {checkEnv as checkEnvShared, generateHttpAuthorizationHeader, createLogger} from './shared';

export {registerSignalHandlers, startHealthCheckService, createLogger} from './shared';

const MAX_MESSAGE_TRIES = 3;
const MESSAGE_WAIT_TIME = 3000;
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

export async function startImport(importCallback) {
	const logger = createLogger();
	const httpHeaders = generateHttpAuthorizationHeader(process.env.API_USERNAME, process.env.API_PASSWORD);
	const maxMessageTries = 'QUEUE_MAX_MESSAGE_TRIES' in process.env ? process.env.QUEUE_MAX_MESSAGE_TRIES : MAX_MESSAGE_TRIES;
	const messageWaitTime = 'QUEUE_MESSAGE_WAIT_TIME' in process.env ? process.env.QUEUE_MESSAGE_WAIT_TIME : MESSAGE_WAIT_TIME;
	const connection = await amqp.connect(process.env.AMQP_URL);
	const channel = await connection.createChannel();

	channel.assertQueue(process.env.PROFILE_ID, {durable: true});

	logger.info(`Ready to consume messages from queue ${process.env.PROFILE_ID}`);
	await consume();

	async function consume(tries = 0) {
		const message = await channel.get(process.env.PROFILE_ID);

		if (message) {
			logger.debug('Record received');

			let response = await fetch(`${process.env.API_URL}/blobs/${message.fields.routingKey}`, {
				headers: Object.assign({'Content-Type': 'application/json'}, httpHeaders)
			});

			if (response.ok) {
				const metadata = await response.json();

				if (metadata.state === 'ABORTED') {
					logger.info('Blob state is set to ABORTED. Ditching message');
					await channel.nack(message, false, false);
					return consume();
				}
				let importResult;

				try {
					importResult = await importCallback(message);
				} catch (err) {
					await channel.ack(message, false, true);
					logger.error(err);
					throw err;
				}

				await channel.ack(message);

				response = await fetch(`${process.env.API_URL}/blobs/${process.env.BLOB_ID}`, {
					method: 'POST',
					headers: Object.assign({'Content-Type': 'application/json'}, httpHeaders),
					body: JSON.stringify({
						op: 'recordProcessed',
						content: importResult
					})
				});

				if (response.ok) {
					return consume();
				}
				throw new Error(`Updating blob state failed: ${response.status} ${response.statusText}`);
			} else {
				throw new Error(`Fetching blob metadata failed: ${response.status} ${response.statusText}`);
			}
		} else if (tries < maxMessageTries) {
			return new Promise(resolve => {
				setTimeout(() => {
					resolve(consume(tries + 1));
				}, messageWaitTime);
			});
		} else {
			logger.info('No more messages in queue');
		}
	}
}
