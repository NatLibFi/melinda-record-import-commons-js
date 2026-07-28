import path from 'path';
import fs from 'fs';
import createDebugLogger from 'debug';
import {createLogger} from '@natlibfi/melinda-backend-commons';

import type {EventEmitter, Readable} from 'stream';

// MARK: Type definitions

export interface CliArgs {
  _: string[];
  fix?: boolean;
  validate?: boolean;
  recordsOnly?: boolean;
  outputDirectory?: string;
}

export type TransformFunction = (stream: Readable, args: CliArgs) => EventEmitter;

export default async function (
  args: CliArgs,
  transform: TransformFunction
): Promise<void> {
  const logger = createLogger();
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugCli = debug.extend('logic');

  const [file] = args._;
  if (file === undefined) {
    throw new Error('File name missing!');
  }

  debugCli(JSON.stringify(args));
  logger.info(`Params given:\nfile: ${file}\nfix: ${args.fix}\nvalidate: ${args.validate}\nrecordsOnly: ${args.recordsOnly}\noutputDirectory: ${args.outputDirectory}`);

  try {
    await new Promise<void>((resolve, reject) => {
      let counter = 0;
      logger.info(`Transforming${args.validate ? ' and validating' : ''}${args.fix ? ' and fixing' : ''} records`);
      logger.info('This will take a moment');
      const stream = fs.createReadStream(file);
      const TransformEmitter = transform(stream, args);

      TransformEmitter
        .on('end', () => {
          logger.info('Transformation done');
          resolve();
        })
        .on('error', err => {
          logger.error(err);
          reject(err);
        })
        .on('record', recordEvent);


      function recordEvent(payload) {
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

          const file = path.join(args.outputDirectory, `${counter}${payload.failed ? '-failed' : ''}.json`);
          debugCli(`Creating new file ${file}`);
          fs.writeFileSync(file, JSON.stringify(payload, undefined, 2));
          counter += 1;
          return;
        }

        console.log(JSON.stringify(payload, undefined, 2));
        counter += 1;

        function initOutputDirectory() {
          if (!fs.existsSync(args.outputDirectory!)) {
            debugCli(`Creating new folder ${args.outputDirectory}`);
            return fs.mkdirSync(args.outputDirectory!);
          }
        }
      };
    })
  } catch (err) {
    logger.error(typeof err === 'object' && 'stack' in err! ? err.stack : err);
    process.exit(-1);
  }
}

