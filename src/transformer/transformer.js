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
import {Utils} from '@natlibfi/melinda-commons';
import createValidator from './validate';
import {registerSignalHandlers, startHealthCheckService} from '../common';
import {createApiClient} from '../api-client';

const {createLogger} = Utils;

export default async function (transformCallback, validateCallback) {
	const {AMQP_URL, API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT, BLOB_ID, PROFILE_ID, ABORT_ON_INVALID_RECORDS, HEALTH_CHECK_PORT} = await import('./config');
	const Logger = createLogger();
	const stopHealthCheckService = startHealthCheckService();

	registerSignalHandlers({stopHealthCheckService});

	try {
		await startTransformation(HEALTH_CHECK_PORT);
		stopHealthCheckService();
		process.exit();
	} catch (err) {
		stopHealthCheckService();
		Logger.error(err instanceof Error ? err.stack : err);
		process.exit(1);
	}

	async function startTransformation() {
		const validate = createValidator(validateCallback);
		const connection = await amqplib.connect(AMQP_URL);
		const ApiClient = createApiClient({url: API_URL, username: API_USERNAME, password: API_PASSWORD, userAgent: API_CLIENT_USER_AGENT});
		const {readStream} = await ApiClient.getBlobContent({id: BLOB_ID});

		Logger.info(`Starting transformation for blob ${BLOB_ID}`);

		try {
			const records = await transform();
			const failedRecords = records.filter(r => r.failed).map(result => {
				return {...result, record: result.record.toObject()};
			});

			Logger.log('debug', `${failedRecords.length} records failed`);

			await ApiClient.setTransformationDone({
				id: BLOB_ID,
				numberOfRecords: records.length,
				failedRecords
			});

			Logger.info('Transformation done');

			if (ABORT_ON_INVALID_RECORDS && failedRecords.length > 0) {
				Logger.info(`Not sending records to queue because ${failedRecords.length} records failed and ABORT_ON_INVALID_RECORDS is true`);
				await ApiClient.setTransformationFailed({id: BLOB_ID, error: failedRecords});
			} else {
				const channel = await connection.createChannel();

				await channel.assertQueue(PROFILE_ID, {durable: true});
				await channel.assertExchange(BLOB_ID, 'direct', {autoDelete: true});
				await channel.bindQueue(PROFILE_ID, BLOB_ID, BLOB_ID);

				const count = await sendRecords(channel, records.filter(r => !r.failed).map(r => r.record.toObject()));

				await channel.unbindQueue(PROFILE_ID, BLOB_ID, BLOB_ID);
				await channel.close();
				await connection.close();

				Logger.info(`${count} records sent to queue ${PROFILE_ID}`);
			}
		} catch (err) {
			Logger.error(`Failed transforming blob: ${err.stack}`);
			await ApiClient.setTransformationFailed({id: BLOB_ID, error: err.stack});
		}

		async function transform() {
			Logger.log('debug', 'Transforming records');

			const records = await transformCallback(readStream);

			Logger.log('debug', 'Validating records');
			return validate(records, true);
		}

		async function sendRecords(channel, records, count = 0) {
			const record = records.shift();

			if (record) {
				const message = Buffer.from(JSON.stringify(record));
				Logger.debug('Sending a record to the queue');
				await channel.publish(BLOB_ID, BLOB_ID, message, {persistent: true});
				return sendRecords(channel, records, count + 1);
			}

			return count;
		}
	}
}
