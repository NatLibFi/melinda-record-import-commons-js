import {getNextBlobId} from '../utils';
import {BLOB_STATE} from '../constants';
import {promisify} from 'util';
import createDebugLogger from 'debug';
import createBlobHandler from './blobHandler';
import prettyPrint from 'pretty-print-ms';

export default async function (riApiClient, transformHandler, amqplib, config) {
  const setTimeoutPromise = promisify(setTimeout);
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugLogic = debug.extend('logic:dev');
  const debugCheckBlobInState = debug.extend('checkBlobInState:dev');
  const blobHandler = createBlobHandler(riApiClient, transformHandler, amqplib, config);
  const polltime = config.polltime ? parseInt(config.polltime, 10) : 3000;

  await logic();

  async function logic(wait = false, waitSinceLastOp = 0) {
    if (wait) {
      debugLogic(`Await ${polltime / 1000} sec`);
      await setTimeoutPromise(polltime);
      const nowWaited = parseInt(polltime, 10) + parseInt(waitSinceLastOp, 10);
      logWait(nowWaited);
      return logic(false, nowWaited);
    }

    const {profileIds} = config;

    // Check if blobs
    debugLogic(`Trying to find blobs for ${profileIds}`);
    if (await checkBlobInState(BLOB_STATE.TRANSFORMATION_IN_PROGRESS)) {
      debugLogic(`Handled blob in state ${BLOB_STATE.TRANSFORMATION_IN_PROGRESS}`);
      return logic();
    }

    if (await checkBlobInState(BLOB_STATE.PENDING_TRANSFORMATION)) {
      debugLogic(`Handled blob in state ${BLOB_STATE.PENDING_TRANSFORMATION}`);
      return logic();
    }

    debugLogic(`No blobs found`);
    return logic(true, waitSinceLastOp);

    async function checkBlobInState(state) {
      try {
        const {id, profile} = await getNextBlobId(riApiClient, {profileIds, state});
        if (id) {
          debugCheckBlobInState(`Handling ${state} blob ${id}, for profile: ${profile}`);

          if (state === BLOB_STATE.TRANSFORMATION_IN_PROGRESS) {
            await blobHandler(id);
            return true;
          }

          if (state === BLOB_STATE.PENDING_TRANSFORMATION) {
            await riApiClient.updateState({id, state: BLOB_STATE.TRANSFORMATION_IN_PROGRESS});
            return true;
          }
        }
        return false;
      } catch (error) {
        debugCheckBlobInState(error);
      }
    }

    function logWait(waitTime) {
      // 60000ms = 1min
      if (waitTime % 60000 === 0) {
        return debug(`Total wait: ${prettyPrint(waitTime)}`);
      }
    }
  }
}
