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

const MANDATORY_ENV_VARIABLES = [
	'API_URL',
	'API_USERNAME',
	'API_PASSWORD',
	'BLOB_ID',
	'AMQP_URL',
	'PROFILE_ID'
];

export function checkEnv() {
	checkEnvShared(MANDATORY_ENV_VARIABLES);
}

export async function startTransformation(transformCallback) {
	const logger = createLogger();
	const httpHeaders = generateHttpAuthorizationHeader(process.env.API_USERNAME, process.env.API_PASSWORD);
	const connection = await amqp.connect(process.env.AMQP_URL);
	const abortOnInvalid = process.env.ABORT_ON_INVALID_RECORDS || false;

	try {
		let response = await fetch(`${process.env.API_URL}/blobs/${process.env.BLOB_ID}/content`, {
			headers: httpHeaders
		});

		if (response.ok) {
			logger.info(`Starting transformation for blob ${process.env.BLOB_ID}`);

			const records = await transformCallback(response);
			const failedRecords = records.filter(r => r.validation.failed);

			response = await fetch(`${process.env.API_URL}/blobs/${process.env.BLOB_ID}`, {
				method: 'POST',
				headers: Object.assign({'Content-Type': 'application/json'}, httpHeaders),
				body: JSON.stringify({
					op: 'transformationDone',
					numberOfRecords: records.length,
					failedRecords: failedRecords.map(r => r.validation.messages)
				})
			});

			logger.info('Transformation done');

			if (response.ok) {
				if (!abortOnInvalid || failedRecords.length === 0) {
					const channel = await connection.createChannel();

					await channel.assertQueue(process.env.PROFILE_ID, {durable: true});
					await channel.assertExchange(process.env.BLOB_ID, 'direct', {autoDelete: true});
					await channel.bindQueue(process.env.PROFILE_ID, process.env.BLOB_ID, process.env.BLOB_ID);

					const count = await sendRecords(channel, records.filter(r => !r.validation.failed));

					await channel.unbindQueue(process.env.PROFILE_ID, process.env.BLOB_ID, process.env.BLOB_ID);
					await channel.close();
					await connection.close();

					logger.info(`${count} records sent to queue ${process.env.PROFILE_ID}`);
				}
			} else {
				throw new Error(`Updating blob state failed: ${response.status} ${response.statusText}`);
			}
		} else {
			throw new Error(`Fetching blob content failed: ${response.status} ${response.statusText}`);
		}
	} catch (err) {
		await connection.close();
		throw err;
	}

	async function sendRecords(channel, records, count = 0) {
		const record = records.shift();

		if (record) {
			const message = Buffer.from(JSON.stringify(record));
			logger.debug('Sending a record to the queue');
			await channel.publish(process.env.BLOB_ID, process.env.BLOB_ID, message, {persistent: true});
			return sendRecords(channel, records, count + 1);
		}
		return count;
	}
}
