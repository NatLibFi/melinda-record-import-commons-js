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

import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import {sync as rmdir} from 'rimraf';

export async function cli(name, callback) {
	const args = yargs
		.scriptName(name)
		.command('$0 <outputDirectory>', '', yargs => {
			yargs
				.positional('outputDirectory', {type: 'string', describe: 'Directory to write files to'})
				.option('y', {alias: 'overwriteDirectory', default: false, type: 'boolean', describe: 'Recreate the output directory if it exists'});
		})
		.parse();

	if (fs.existsSync(args.outputDirectory)) {
		if (args.overwriteDirectory) {
			rmdir(args.outputDirectory);
		} else {
			console.error(`Directory ${args.outputDirectory} already exists!`);
			process.exit(-1);
		}
	}

	fs.mkdirSync(args.outputDirectory);

	let count = 0;

	await callback(data => {
		fs.writeFileSync(path.join(args.outputDirectory, String(count)), data);
		count++;
	});
}
