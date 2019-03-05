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

import fs from 'fs';
import yargs from 'yargs';
import ora from 'ora';
import amqp from 'amqplib';
import {checkEnv as checkEnvShared, createLogger} from './common';
import {createApiClient} from './api-client';

export function checkEnv() {
	checkEnvShared([
		'API_URL',
		'API_USERNAME',
		'API_PASSWORD',
		'BLOB_ID',
		'AMQP_URL',
		'PROFILE_ID'
	]);
}

export async function startTransformation({callback, blobId, profile, apiURL, apiUsername, apiPassword, amqpURL, abortOnInvalid = false}) {
	const logger = createLogger();
	const connection = await amqp.connect(amqpURL);
	const ApiClient = createApiClient({url: apiURL, username: apiUsername, password: apiPassword});
	const readStream = await ApiClient.getBlobContent(blobId);

	logger.info(`Starting transformation for blob ${blobId}`);

	try {
		const records = await callback(readStream);

		const failedRecords = records.filter(r => r.failed);

		await ApiClient.setTransformationDone({
			id: blobId,
			numberOfRecords: records.length,
			failedRecords
		});

		logger.info('Transformation done');

		if (abortOnInvalid && failedRecords.length > 0) {
			logger.info('Not sending records to query because ABORT_ON_INVALID_RECORDS is true');

			await ApiClient.setTransformationFailed({id: blobId, error: failedRecords});
		} else {
			const channel = await connection.createChannel();

			await channel.assertQueue(profile, {durable: true});
			await channel.assertExchange(blobId, 'direct', {autoDelete: true});
			await channel.bindQueue(profile, blobId, blobId);

			const count = await sendRecords(channel, records.filter(r => !r.validation.failed));

			await channel.unbindQueue(profile, blobId, blobId);
			await channel.close();
			await connection.close();

			logger.info(`${count} records sent to queue ${profile}`);
		}
	} catch (err) {
		logger.error(`Failed transforming blob: ${err.stack}`);
		await ApiClient.setTransformationFailed({id: blobId, error: err.stack});
	}

	async function sendRecords(channel, records, count = 0) {
		const record = records.shift();

		if (record) {
			const message = Buffer.from(JSON.stringify(record));
			logger.debug('Sending a record to the queue');
			await channel.publish(blobId, blobId, message, {persistent: true});
			return sendRecords(channel, records, count + 1);
		}

		return count;
	}
}

export async function runValidation(validateFunc, records, fix = false) {
	const opts = fix ? {fix: true, validateFixes: true} : {fix: false};
	const results = await Promise.all(
		records.map(r => validateFunc(r, opts))
	);

	return results.map(result => ({
		record: result.record,
		failed: !result.valid,
		messages: result.report
	}));
}

export async function cli(name, transformCallback, validateCallback) {
	const args = yargs
		.scriptName(name)
		.command('$0 <file>', '', yargs => {
			yargs
				.positional('file', {type: 'string', describe: 'File to transform'})
				.option('v', {alias: 'validate', default: false, type: 'boolean', describe: 'Validate records'})
				.option('f', {alias: 'fix', default: false, type: 'boolean', describe: 'Validate & fix records'})
				.option('r', {alias: 'recordsOnly', default: false, type: 'boolean', describe: 'Write only record data to output (Invalid records are excluded)'});
		})
		.parse();

	if (!fs.existsSync(args.file)) {
		console.error(`File ${args.file} does not exist`);
		process.exit(-1);
	}

	const spinner = ora('Transforming records').start();
	const records = await transformCallback(fs.createReadStream(args.file));

	if (args.validate || args.fix) {
		spinner.succeed();
		spinner.start('Validating records');

		const results = await validateCallback(records, args.fix);
		const invalidCount = results.filter(r => r.failed).length;
		const validCount = results.length - invalidCount;
		spinner.succeed(`Validating records (Valid: ${validCount}, invalid: ${invalidCount})`);

		if (args.recordsOnly) {
			console.error(`Excluding ${results.filter(r => r.failed).length} failed records`);
			console.log(JSON.stringify(results.filter(r => !r.failed).map(r => r.record.toObject()), undefined, 2));
		} else {
			console.log(JSON.stringify(results.map(r => {
				return Object.assign(r, {record: r.record.toObject()});
			}), undefined, 2));
		}
	} else {
		spinner.succeed();
		console.log(JSON.stringify(records.map(r => r.toObject()), undefined, 2));
	}
}
