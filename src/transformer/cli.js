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
import {fail} from 'assert';

export default async ({name, yargsOptions = [], callback}) => {
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
		console.error(`File ${args.file} does not exist`);
		process.exit(-1);
	}

	const spinner = ora(`Transforming${args.validate ? ' and validating' : ''}${args.fix ? ' and fixing' : ''} records`).start();

	const options = {
		stream: fs.createReadStream(args.file),
		args
	};

	const TransformClient = callback(options);
	let succesRecordArray = [];
	let failedRecordsArray = [];

	(async () => {
		try {
			TransformClient
				.on('transform', transformEvent)
				.on('log', logEvent)
				.on('record', recordEvent);
		} catch (e) {
			console.error('Transformation failed! Error: ' + e)
		}
	})();

	async function transformEvent({state}) {
		if (state === 'start') {
		
		}
		if (state === 'end') {
			console.log('End starts');
			if (args.validate || args.fix) {
				spinner.succeed(`Valid records: ${succesRecordArray.length}, invalid records: ${failedRecordsArray.length}`);
			} else {
				spinner.succeed();
			}
			console.log(succesRecordArray.length);
			let records = succesRecordArray;
			if (!args.recordsOnly && failedRecordsArray.length > 0) {
				records.join(failedRecordsArray);
			}
			records = records.map(r => r.record);
			if (args.outputDirectory) {
				if (!fs.existsSync(args.outputDirectory)) {
					fs.mkdirSync(args.outputDirectory);
				}

				records
					.forEach((record, index) => {
						const file = path.join(args.outputDirectory, `${index}.json`);
						fs.writeFileSync(file, JSON.stringify(record.toObject(), undefined, 2));
					});
			} else {
				console.log(JSON.stringify(records.map(r => r.toObject()), undefined, 2));
			}
		}
	}

	function logEvent(logs) {
		console.log(logs);
	}

	function recordEvent(payload) {
		//console.log('debug', 'Record failed: ' + payload.failed);
		{payload.failed ? failedRecordsArray.push(payload) : succesRecordArray.push(payload)};
	}
};
