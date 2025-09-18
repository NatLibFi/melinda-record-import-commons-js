import createDebugLogger from 'debug';
import {promisify} from 'util';

import {createLogger, millisecondsToString} from '@natlibfi/melinda-backend-commons';

import {getNextBlob} from '../utils.js';
import {BLOB_STATE, BLOB_UPDATE_OPERATIONS} from '../constants.js';
import createBlobHandler from './blobHandler.js';

export default async function (mongoOperator, amqpOperator, processHandler, config) {
  const logger = createLogger();
  const setTimeoutPromise = promisify(setTimeout);
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugPolling = debug.extend('poll');
  const blobHandler = createBlobHandler(mongoOperator, amqpOperator, processHandler, config);
  const polltime = config.polltime ? parseInt(config.polltime, 10) : 3000;

  await logic();

  async function logic(wait = false, waitSinceLastOp = 0) {
    if (wait) {
      debugPolling(`Await ${polltime / 1000} sec`);
      await setTimeoutPromise(polltime);
      const nowWaited = parseInt(polltime, 10) + parseInt(waitSinceLastOp, 10);
      logWait(nowWaited);
      return logic(false, nowWaited);
    }

    const {profileIds} = config;

    // Check if blobs
    debugPolling(`Trying to find blobs for ${profileIds}`);
    if (await checkBlobInState(BLOB_STATE.TRANSFORMATION_IN_PROGRESS)) {
      debugPolling(`Handled blob in state ${BLOB_STATE.TRANSFORMATION_IN_PROGRESS}`);
      return logic();
    }

    if (await checkBlobInState(BLOB_STATE.PENDING_TRANSFORMATION)) {
      debugPolling(`Handled blob in state ${BLOB_STATE.PENDING_TRANSFORMATION}`);
      return logic();
    }

    debugPolling(`No blobs found`);
    return logic(true, waitSinceLastOp);

    async function checkBlobInState(state) {
      try {
        const {id, profile} = await getNextBlob(mongoOperator, {profileIds, state});
        if (id) {
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
