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

import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import {createLogger} from '@natlibfi/melinda-backend-commons';

export default async function ({name, callback}) {
  const logger = createLogger();
  const args = yargs
    .scriptName(name)
    .command('$0 <file>', '', yargs => {
      yargs
        .positional('file', {type: 'string', describe: 'File to import or directory containing files'});
    })
    .parse();

  if (!fs.existsSync(args.file)) {
    logger.error(`File ${args.file} does not exist`);
    return process.exit(-1); // eslint-disable-line no-process-exit
  }

  logger.info('Importing records');

  await processFiles(getFiles());

  function getFiles() {
    if (fs.lstatSync(args.file).isDirectory()) {
      return fs.readdirSync(args.file).map(f => path.join(args.file, f));
    }

    return [path.resolve(args.file)];
  }

  async function processFiles(files) {
    const [file] = files;

    if (file) { // eslint-disable-line functional/no-conditional-statement
      logger.info('Importing record');

      try {
        const message = getMessage();
        const result = await callback(message); // eslint-disable-line callback-return
        logger.info(`Imported record: ${JSON.stringify(result)}`);
        return processFiles(files.slice(1));
      } catch (err) {
        logger.error(err.stack);
        return process.exit(1); // eslint-disable-line no-process-exit
      }
    }

    function getMessage() {
      const str = fs.readFileSync(file, 'utf8');

      return {
        content: {
          toString: () => str
        }
      };
    }
  }
}
