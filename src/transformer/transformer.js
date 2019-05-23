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

/* Not sure why this is needed only in this module... */
/* eslint-disable import/default */

import amqplib from 'amqplib';
import uuid from 'uuid/v4';
import {Utils} from '@natlibfi/melinda-commons';
import createValidator from './validate';
import {registerSignalHandlers, startHealthCheckService} from '../common';
import {createApiClient} from '../api-client';

const {createLogger} = Utils;

export default async function (transformCallback, validateCallback) {
	const {AMQP_URL, API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT, BLOB_ID, PROFILE_ID, ABORT_ON_INVALID_RECORDS, HEALTH_CHECK_PORT} = await import('./config');
	const logger = createLogger();
	const stopHealthCheckService = startHealthCheckService();

	registerSignalHandlers({stopHealthCheckService});

	try {
		await startTransformation(HEALTH_CHECK_PORT);
		stopHealthCheckService();
		process.exit();
	} catch (err) {
		stopHealthCheckService();
		logger.log('error', err instanceof Error ? err.stack : err);
		process.exit(1);
	}

	async function startTransformation() {
		let connection;
		let channel;

		const validate = createValidator(validateCallback);
		const ApiClient = createApiClient({url: API_URL, username: API_USERNAME, password: API_PASSWORD, userAgent: API_CLIENT_USER_AGENT});
		const {readStream} = await ApiClient.getBlobContent({id: BLOB_ID});

		logger.log('info', `Starting transformation for blob ${BLOB_ID}`);

		try {
			connection = await amqplib.connect(AMQP_URL);
			channel = await connection.createChannel();

			const records = await transform();
			const failedRecords = records.filter(r => r.failed).map(result => {
				return {...result, record: result.record.toObject()};
			});

			logger.log('debug', `${failedRecords.length} records failed`);

			await ApiClient.setTransformationDone({
				id: BLOB_ID,
				numberOfRecords: records.length,
				failedRecords
			});

			logger.log('info', 'Transformation done');

			if (ABORT_ON_INVALID_RECORDS && failedRecords.length > 0) {
				logger.log('info', `Not sending records to queue because ${failedRecords.length} records failed and ABORT_ON_INVALID_RECORDS is true`);
				await ApiClient.setTransformationFailed({id: BLOB_ID, error: failedRecords});
			} else {
				await channel.assertQueue(BLOB_ID, {durable: true});
				// Await channel.assertExchange(BLOB_ID, 'direct', {autoDelete: true});
				// await channel.bindQueue(PROFILE_ID, BLOB_ID, BLOB_ID);

				const count = await sendRecords(channel, records.filter(r => !r.failed).map(r => r.record.toObject()));

				// Await channel.unbindQueue(PROFILE_ID, BLOB_ID, BLOB_ID);
				logger.log('info', `${count} records sent to queue ${PROFILE_ID}`);
			}
		} catch (err) {
			logger.log('error', `Failed transforming blob: ${err.stack}`);
			await ApiClient.setTransformationFailed({id: BLOB_ID, error: err.stack});
		} finally {
			if (channel) {
				await channel.close();
			}

			if (connection) {
				await connection.close();
			}
		}

		async function transform() {
			logger.log('debug', 'Transforming records');

			const records = await transformCallback(readStream);

			logger.log('debug', 'Validating records');
			return validate(records, true);
		}

		async function sendRecords(channel, records, count = 0) {
			const record = records.shift();

			if (record) {
				const message = Buffer.from(JSON.stringify(record));
				logger.log('debug', 'Sending a record to the queue');
				await channel.sendToQueue(BLOB_ID, message, {persistent: true, messageId: uuid()});
				return sendRecords(channel, records, count + 1);
			}

			return count;
		}
	}
}
