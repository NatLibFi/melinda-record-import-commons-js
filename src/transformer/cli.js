/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* Shared modules for microservices of Melinda record batch import system
*
* Copyright (C) 2018-2022 University Of Helsinki (The National Library Of Finland)
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

import path from 'path';
import fs from 'fs';
import createDebugLogger from 'debug';
import {createLogger} from '@natlibfi/melinda-backend-commons';

export default async function (args, transform) {
  const logger = createLogger();
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugCli = debug.extend('logic');

  const [file] = args._;
  debugCli(JSON.stringify(args));
  logger.info(`Params given:\nfile: ${file}\nfix: ${args.fix}\nvalidate: ${args.validate}\nrecordsOnly: ${args.recordsOnly}\noutputDirectory: ${args.outputDirectory}`);

  try {
    await new Promise((resolve, reject) => {
      let counter = 0; // eslint-disable-line functional/no-let
      logger.info(`Transforming${args.validate ? ' and validating' : ''}${args.fix ? ' and fixing' : ''} records`);
      logger.info('This will take a moment');
      const stream = fs.createReadStream(file);
      const TransformEmitter = transform(stream, args); // eslint-disable-line callback-return
      const pendingPromises = [];

      TransformEmitter
        .on('end', () => {
          Promise.all(pendingPromises);
          logger.info('Transformation done');
          resolve();
        })
        .on('error', err => {
          logger.error(err);
          reject(err);
        })
        .on('record', payload => {
          pendingPromises.push(recordEvent(payload)); // eslint-disable-line functional/immutable-data

          function recordEvent(payload) {
            if (payload.failed) {
              debugCli('Record transformation failed');
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
            debugCli('Got transformed record');
            if (args.outputDirectory) {
              initOutputDirectory();

              const file = path.join(args.outputDirectory, `${counter}.json`);
              debugCli(`Creating new file ${file}`);
              fs.writeFileSync(file, JSON.stringify(payload, undefined, 2));
              counter += 1;
              return;
            }

            console.log(JSON.stringify(payload, undefined, 2)); // eslint-disable-line no-console
            counter += 1;

            function initOutputDirectory() {
              if (!fs.existsSync(args.outputDirectory)) {
                debugCli(`Creating new folder ${args.outputDirectory}`);
                return fs.mkdirSync(args.outputDirectory);
              }
            }
          }
        });
    });
  } catch (err) {
    logger.error(typeof err === 'object' && 'stack' in err ? err.stack : err);
    process.exit(-1); // eslint-disable-line no-process-exit
  }
}
