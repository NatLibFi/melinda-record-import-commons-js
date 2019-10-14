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
import {registerSignalHandlers, startHealthCheckService} from '../common';
import {createApiClient} from '../api-client';
import moment from 'moment';
import {BLOB_STATE} from '../constants';

const {createLogger} = Utils;

export default async function (transformCallback) {
	const {AMQP_URL, API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT, BLOB_ID, ABORT_ON_INVALID_RECORDS, HEALTH_CHECK_PORT} = await import('./config');
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

		const ApiClient = createApiClient({url: API_URL, username: API_USERNAME, password: API_PASSWORD, userAgent: API_CLIENT_USER_AGENT});
		const {readStream} = await ApiClient.getBlobContent({id: BLOB_ID});

		logger.log('info', `Starting transformation for blob ${BLOB_ID}`);

		try {
			connection = await amqplib.connect(AMQP_URL);
			channel = await connection.createChannel();
			const TransformEmitter = transformCallback(readStream, {});
			let hasFailed = false;
			const pendingPromises = [];

			await new Promise((resolve, reject) => {
				TransformEmitter
					.on('end', async (count = 0) => {
						logger.log('debug', `Transformer has handled ${pendingPromises.length / 2} / ${count} record promises to line, waiting them to be resolved`);
						await Promise.all(pendingPromises);
						logger.log('debug', `Transforming is done (${pendingPromises.length / 2} / ${count} Promises resolved)`);

						if (ABORT_ON_INVALID_RECORDS && hasFailed) {
							logger.log('info', 'Not sending records to queue because some records failed and ABORT_ON_INVALID_RECORDS is true');
							await ApiClient.setTransformationFailed({id: BLOB_ID, error: {message: 'Some records have failed'}});
						} else {
							logger.log('info', `Setting blob state ${BLOB_STATE.TRANSFORMED}¸¸`);
							await ApiClient.updateState({id: BLOB_ID, state: BLOB_STATE.TRANSFORMED});
						}

						resolve(true);
					})
					.on('error', err => {
						logger.log('info', 'Transformation failed');
						ApiClient.setTransformationFailed({id: BLOB_ID, error: err});
						reject(err);
					})
					.on('record', async payload => {
						payload.timeStamp = moment();
						pendingPromises.push(sendRecordToQueue(payload));
						pendingPromises.push(updateBlob(payload));

						async function sendRecordToQueue(payload) {
							if (!payload.failed) {
								if ((!ABORT_ON_INVALID_RECORDS || (ABORT_ON_INVALID_RECORDS && !hasFailed))) {
									try {
										channel.assertQueue(BLOB_ID, {durable: true});
										const message = Buffer.from(JSON.stringify(payload.record));
										await channel.sendToQueue(BLOB_ID, message, {persistent: true, messageId: uuid()});
									} catch (err) {
										logger.log('error', `Error while sending record to queue: ${err instanceof Error ? err.stack : err}`);
									}
								}
							}
						}

						async function updateBlob(payload) {
							try {
								if (payload.failed) {
									hasFailed = true;
									await ApiClient.transformedRecord({
										id: BLOB_ID,
										error: payload.record
									});
								} else {
									await ApiClient.transformedRecord({
										id: BLOB_ID
									});
								}
							} catch (err) {
								logger.log('error', `Error while updating blob: ${err instanceof Error ? err.stack : err}`);
							}
						}
					});
			});
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
	}
}
