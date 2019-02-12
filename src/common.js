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

import http from 'http';
import {URL} from 'url';
import moment from 'moment';
import winston from 'winston';

export function createLogger() {
	const timestamp = winston.format(info => {
		info.timestamp = moment().format();
		return info;
	});

	return winston.createLogger({
		silent: process.env.NODE_ENV === 'test',
		level: process.env.DEBUG ? 'debug' : 'info',
		format: winston.format.combine(
			timestamp(),
			winston.format.printf(i => `${i.timestamp} - ${i.level}: ${i.message}`)
		),
		transports: [
			new winston.transports.Console()
		]
	});
}

export function registerSignalHandlers() {
	process.on('SIGINT', () => {
		process.exit(1);
	});
}

export function generateHttpAuthorizationHeader(username, password) {
	return `Basic ${Buffer.from(`{username}:${password}`).toString('base64')}`;
}

export function checkEnv(mandatoryVariables) {
	const missingVariables = mandatoryVariables.filter(v => !Object.keys(process.env).includes(v));

	if (missingVariables.length > 0) {
		throw new Error(`Mandatory environment variables are not defined: ${missingVariables.join(',')}`);
	}
}

export function startHealthCheckService(port = 8080) {
	const server = http.createServer((req, res) => {
		const requestURL = new URL(req.url);

		res.statusCode = requestURL.pathname === '/healthz' ? 200 : 404;
		res.end();
	}).listen(port);
	return async function () {
		return new Promise(resolve => {
			server.close(resolve);
		});
	};
}

export function readEnvironmentVariable(name, defaultValue, opts = {}) {
	if (process.env[name] === undefined) {
		if (defaultValue === undefined) {
			throw new Error(`Mandatory environment variable missing: ${name}`);
		}

		const loggedDefaultValue = opts.hideDefaultValue ? '[hidden]' : defaultValue;
		console.log('info', `No environment variable set for ${name}, using default value: ${loggedDefaultValue}`);
	}

	return process.env[name] || defaultValue;
}
