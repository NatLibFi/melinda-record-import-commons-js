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

import {getNextBlobId} from '../utils';
import {BLOB_STATE} from '../constants';
import {promisify} from 'util';
import createDebugLogger from 'debug';
import createBlobHandler from './blobHandler';

export default async function (riApiClient, transformHandler, amqplib, config) {
  const setTimeoutPromise = promisify(setTimeout);
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons');
  const debugLogic = debug.extend('logic');
  const debugCheckBlobInState = debug.extend('checkBlobInState');
  const blobHandler = createBlobHandler(riApiClient, transformHandler, amqplib, config);
  const polltime = config.polltime ? parseInt(config.polltime, 10) : 3000;

  await logic();

  async function logic(wait = false) {

    if (wait) {
      debugLogic(`Await ${polltime / 1000} sec`);
      await setTimeoutPromise(polltime);
      return logic();
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
    return logic(true);

    async function checkBlobInState(state) {
      try {
        const {blobId, profile} = await getNextBlobId(riApiClient, {profileIds, state});
        debugCheckBlobInState(`Got blob id: ${blobId}`);
        if (blobId) {
          debugCheckBlobInState(`Handling ${state} blob ${blobId}, for profile: ${profile}`);

          if (state === BLOB_STATE.TRANSFORMATION_IN_PROGRESS) {
            await blobHandler(blobId);
            return true;
          }

          if (state === BLOB_STATE.PENDING_TRANSFORMATION) {
            await riApiClient.updateState({id: blobId, state: BLOB_STATE.TRANSFORMATION_IN_PROGRESS});
            return true;
          }
        }

        return false;
      } catch (error) {
        debugCheckBlobInState(error);
      }
    }
  }
}
