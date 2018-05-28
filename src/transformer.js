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

import http from 'http';
import {parse as parseUrl} from 'url';
import amqp from 'amqplib';
import fetch from 'node-fetch';

const MANDATORY_ENV_VARIABLES = [
	'API_URL',
	'API_USERNAME',
	'API_PASSWORD',
	'BLOB_ID',
	'AMQP_URL',
	'QUEUE_NAME'
];

export function registerSignalHandlers() {
	process.on('SIGINT', () => {
		process.exit(1);
	});
}

export function generateHttpAuthorizationHeader(username, password) {
	return {Authorization: `Basic ${Buffer.from(`{username}:${password}`).toString('base64')}`};
}

export function checkEnv(mandatoryVariables = MANDATORY_ENV_VARIABLES) {
	const missingVariables = mandatoryVariables.filter(v => !Object.keys(process.env).includes(v));

	if (missingVariables.length > 0) {
		throw new Error(`Mandatory environment variables are not defined: ${missingVariables.join(',')}`);
	}
}

export function startHealthCheckService() {
	const server = http.createServer((req, res) => {
		const path = parseUrl(req.url);
		res.statusCode = path === '/healthz' ? 200 : 404;
		res.end();
	}).listen(8080);
	return async function () {
		return new Promise(resolve => {
			server.close(resolve);
		});
	};
}

export async function startTransformation(transformCallback, contentType) {
	const httpHeaders = generateHttpAuthorizationHeader(process.env.API_USERNAME, process.env.API_PASSWORD);
	const queue = await amqp.connect(process.env.AMQP_URL);
	const abortOnInvalid = process.env.ABORT_ON_INVALID_RECORDS || false;

	let response = await fetch(`${process.env.API_URL}/blobs/${process.env.BLOB_ID}/content`, {
		headers: httpHeaders
	});

	if (response.ok) {
		const records = await transformCallback(response);
		const failedRecords = records.filter(r => r.validation.failed);

		response = await fetch(`${process.env.API_URL}/blobs/${process.env.BLOB_ID}`, {
			method: 'POST',
			headers: Object.assign({'Content-Type': contentType}, httpHeaders),
			body: JSON.stringify({
				op: 'transformationDone',
				numberOfRecords: records.length,
				failedRecords: failedRecords.map(r => r.validation.messages)
			})
		});

		if (response.ok) {
			if (!abortOnInvalid || failedRecords.length === 0) {
				const channel = await queue.createChannel();

				records.filter(r => !r.validation.failed).forEach(async record => {
					const message = Buffer.from(JSON.stringify(record));
					channel.assertQueue(process.env.QUEUE_NAME);
					await channel.sendToQueue(process.env.QUEUE_NAME, message);
				});
			}
		} else {
			throw new Error(`Updating blob state failed: ${response.status} ${response.statusText}`);
		}
	} else {
		throw new Error(`Fetching blob content failed: ${response.status} ${response.statusText}`);
	}
}
