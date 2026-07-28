import createDebugLogger from 'debug';
import {setTimeout} from 'node:timers/promises';

import {createLogger, millisecondsToString} from '@natlibfi/melinda-backend-commons';

import {getNextBlob} from '../utils.ts';
import {BLOB_STATE, BLOB_UPDATE_OPERATIONS} from '../constants.ts';
import createBlobHandler from './blobHandler.ts';

import type {AmqpOperator} from '../amqp.ts';
import type {BlobDocument, MongoBlobsOperator} from '../mongoBlobs.ts';
import type {ProcessHandler} from './blobHandler.ts';
import type {Readable} from 'stream';

// MARK: Type definitions

export interface TransformerConfig {
  profileIds: string[];
  polltime?: string;
  abortOnInvalidRecords?: boolean;
  readFrom?: 'blobContent' | Readable;
  nextQueueStatus?: keyof typeof BLOB_STATE;
}

export default async function (
  mongoOperator: MongoBlobsOperator,
  amqpOperator: AmqpOperator,
  processHandler: ProcessHandler,
  config: TransformerConfig
) {
  const logger = createLogger();
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugPolling = debug.extend('poll');
  const blobHandler = createBlobHandler(mongoOperator, amqpOperator, processHandler, config);
  const polltime: number = config.polltime ? parseInt(config.polltime, 10) : 3000;

  await logic();

  async function logic(wait = false, waitSinceLastOp = 0) {
    if (wait) {
      debugPolling(`Await ${polltime / 1000} sec`);
      await setTimeout(polltime);
      const nowWaited = polltime + waitSinceLastOp;
      logWait(nowWaited);
      return logic(false, nowWaited);
    }

    const {profileIds} = config;

    // MARK: Check if blobs in state TRANSFORMATION_IN_PROGRESS
    debugPolling(`Trying to find blobs for ${profileIds}`);
    if (await checkBlobInState(BLOB_STATE.TRANSFORMATION_IN_PROGRESS)) {
      debugPolling(`Handled blob in state ${BLOB_STATE.TRANSFORMATION_IN_PROGRESS}`);
      return logic();
    }

    // MARK: Check if blobs in state PENDING_TRANSFORMATION
    if (await checkBlobInState(BLOB_STATE.PENDING_TRANSFORMATION)) {
      debugPolling(`Handled blob in state ${BLOB_STATE.PENDING_TRANSFORMATION}`);
      return logic();
    }

    debugPolling(`No blobs found`);
    return logic(true, waitSinceLastOp);

    async function checkBlobInState(state: keyof typeof BLOB_STATE) {
      try {
        const blobInfo = await getNextBlob(mongoOperator, {profileIds, state});
        if (blobInfo) {
          const {id, profile} = blobInfo as BlobDocument;
          logger.info(`Handling blob ${id} @ state ${state}, for profile: ${profile}`);
          debugPolling(`Handling ${state} blob ${id}, for profile: ${profile}`);

          if (state === BLOB_STATE.TRANSFORMATION_IN_PROGRESS) {
            await blobHandler(id);
            return true;
          }

          if (state === BLOB_STATE.PENDING_TRANSFORMATION) {
            await mongoOperator.updateBlob({
              id,
              payload: {
                op: BLOB_UPDATE_OPERATIONS.updateState,
                state: BLOB_STATE.TRANSFORMATION_IN_PROGRESS
              }
            });
            return true;
          }
        }
        return false;
      } catch (error) {
        debug(error);
        throw error;
      }
    }

    function logWait(waitTime) {
      // 60000ms = 1min
      if (waitTime % 60000 === 0) {
        return logger.info(`Total wait: ${millisecondsToString(waitTime)}`);
      }
    }
  }
}
