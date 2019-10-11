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
import path from 'path';
import {Utils} from '@natlibfi/melinda-commons';

const {createLogger} = Utils;

export default async ({name, yargsOptions = [], callback}) => {
	const logger = createLogger();

	const args = yargs
		.scriptName(name)
		.command('$0 <file>', '', yargs => {
			yargs
				.positional('file', {type: 'string', describe: 'File to transform'})
				.option('r', {alias: 'recordsOnly', default: false, type: 'boolean', describe: 'Write only record data to output (Invalid records are excluded)'})
				.option('d', {alias: 'outputDirectory', type: 'string', describe: 'Output directory where each record file is written (Applicable only with `recordsOnly`'});
			yargsOptions.forEach(({option, conf}) => {
				yargs.option(option, conf);
			});
		})
		.parse();

	if (!fs.existsSync(args.file)) {
		logger.log('error', `File ${args.file} does not exist`);
		process.exit(-1);
	}

	const spinner = ora(`Transforming${args.validate ? ' and validating' : ''}${args.fix ? ' and fixing' : ''} records`).start();

	const stream = fs.createReadStream(args.file);
	const TransformEmitter = callback(stream, args);
	const pendingPromises = [];

	await new Promise((resolve, reject) => {
		let counter = 0;

		TransformEmitter
			.on('end', async () => {
				Promise.all(pendingPromises);
				spinner.succeed();
				resolve();
			})
			.on('error', err => {
				logger.log('error', err);
				reject(err);
			})
			.on('record', async payload => {
				pendingPromises.push(recordEvent(payload));

				async function recordEvent(payload) {
					// Console.log('debug', 'Record failed: ' + payload.failed);
					if (payload.failed) {
						if (!args.recordsOnly) {
							// Send record to be handled
							handleOutput(payload.record);
						}
					} else {
						// Send record to be handled
						handleOutput(payload.record);
					}
				}

				function handleOutput(record) {
					if (args.outputDirectory) {
						if (!fs.existsSync(args.outputDirectory)) {
							fs.mkdirSync(args.outputDirectory);
						}

						const file = path.join(args.outputDirectory, `${counter}.json`);
						counter++;
						fs.writeFileSync(file, JSON.stringify(record, undefined, 2));
					} else {
						console.log(JSON.stringify(record, undefined, 2));
						counter++;
					}
				}
			});
	});
};
