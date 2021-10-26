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
import yargs from 'yargs';
import path from 'path';
import {createLogger} from '@natlibfi/melinda-backend-commons';

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
    logger.error(`File ${args.file} does not exist`);
    return process.exit(-1); // eslint-disable-line no-process-exit
  }

  try {
    await new Promise((resolve, reject) => {
      let counter = 0; // eslint-disable-line functional/no-let

      logger.info(`Transforming${args.validate ? ' and validating' : ''}${args.fix ? ' and fixing' : ''} records`);
      const stream = fs.createReadStream(args.file);
      const TransformEmitter = callback(stream, args); // eslint-disable-line callback-return
      const pendingPromises = [];

      TransformEmitter
        .on('end', () => {
          Promise.all(pendingPromises);
          logger.info('Done');
          resolve();
        })
        .on('error', err => {
          logger.info('Error');
          reject(err);
        })
        .on('record', payload => {
          pendingPromises.push(recordEvent(payload)); // eslint-disable-line functional/immutable-data

          function recordEvent(payload) {
            if (payload.failed) {
              // Send record to be handled
              if (!args.recordsOnly) {
                handleOutput(payload);
                return;
              }

              return;
            }

            if (args.recordsOnly) {
              handleOutput(payload.record);
              return;
            }

            handleOutput(payload);
          }

          function handleOutput(payload) {
            if (args.outputDirectory) {
              initOutputDirectory();

              const file = path.join(args.outputDirectory, `${counter}.json`);
              fs.writeFileSync(file, JSON.stringify(payload, undefined, 2));
              counter += 1;
              return;
            }

            logger.log(JSON.stringify(payload, undefined, 2));
            counter += 1;

            function initOutputDirectory() {
              if (!fs.existsSync(args.outputDirectory)) {
                return fs.mkdirSync(args.outputDirectory);
              }
            }
          }
        });
    });
  } catch (err) {
    logger.log('error', typeof err === 'object' && 'stack' in err ? err.stack : err);
    process.exit(-1); // eslint-disable-line no-process-exit
  }
};
