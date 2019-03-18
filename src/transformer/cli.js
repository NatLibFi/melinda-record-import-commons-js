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
import createValidator from './validate';

export default async function ({name, transformCallback, validateCallback}) {
	const validate = createValidator(validateCallback);
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

		const results = await validate(records, args.fix);
		const invalidCount = results.filter(r => r.failed).length;
		const validCount = results.length - invalidCount;
		spinner.succeed(`Validating records (Valid: ${validCount}, invalid: ${invalidCount})`);

		if (args.recordsOnly) {
			console.error(`Excluding ${results.filter(r => r.failed).length} failed records`);
			console.log(JSON.stringify(results.filter(r => !r.failed).map(r => r.record.toObject()), undefined, 2));
		} else {
			console.log(JSON.stringify(results.map(r => {
				return {record: r.record.toObject(), ...r};
			}), undefined, 2));
		}
	} else {
		spinner.succeed();
		console.log(JSON.stringify(records.map(r => r.toObject()), undefined, 2));
	}
}
