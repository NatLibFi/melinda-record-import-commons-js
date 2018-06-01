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
import winston from 'winston';

export function createLogger() {
	return new winston.Logger({
		level: process.env.NODE_ENV === 'debug' ? 'debug' : 'info',
		transports: [
			new (winston.transports.Console)()
		]
	});
}

export function registerSignalHandlers() {
	process.on('SIGINT', () => {
		process.exit(1);
	});
}

export function generateHttpAuthorizationHeader(username, password) {
	return {Authorization: `Basic ${Buffer.from(`{username}:${password}`).toString('base64')}`};
}

export function checkEnv(mandatoryVariables) {
	const missingVariables = mandatoryVariables.filter(v => !Object.keys(process.env).includes(v));

	if (missingVariables.length > 0) {
		throw new Error(`Mandatory environment variables are not defined: ${missingVariables.join(',')}`);
	}
}

export function startHealthCheckService(port = 8080) {
	const server = http.createServer((req, res) => {
		const path = parseUrl(req.url);
		res.statusCode = path === '/healthz' ? 200 : 404;
		res.end();
	}).listen(port);
	return async function () {
		return new Promise(resolve => {
			server.close(resolve);
		});
	};
}
