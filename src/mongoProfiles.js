/* eslint-disable max-lines */
import createDebugLogger from 'debug';
import httpStatus from 'http-status';
import sanitize from 'mongo-sanitize';
import {MongoClient} from 'mongodb';
import {EventEmitter} from 'events';

import {createLogger} from '@natlibfi/melinda-backend-commons';
import {Error as ApiError} from '@natlibfi/melinda-commons';

import {generateProfileQuery} from './utils';

export async function createMongoProfilesOperator(mongoUrl, db = 'db') {
  const logger = createLogger(); // eslint-disable-line
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:mongoProfiles');
  const debugDev = createDebugLogger('@natlibfi/melinda-record-import-commons:mongoProfiles:dev');

  // Connect to mongo (MONGO)
  const client = await MongoClient.connect(mongoUrl);
  const dbConnection = client.db(db);
  const operator = dbConnection.collection('profiles');

  return {queryProfile, createOrModifyProfile, readProfile, removeProfile, closeClient};

  // MARK: Query Profile
  function queryProfile(params = {}) {
    debug(`Querying: ${JSON.stringify(params)}`);
    const emitter = new EventEmitter();
    const {limit = 100, skip = 0, getAll = true, ...rest} = params;
    //logger.debug(`getAll: ${getAll}`);
    //logger.debug(`rest: ${rest}`);

    const query = generateProfileQuery(rest);

    handleProfileQuery(getAll, skip);

    return emitter;

    async function handleProfileQuery(getAll, skip) {
      try {
        // .find(<query>, <projection>, <options>)
        const profilesArray = await operator.find(query, {projection: {_id: 0}}) // eslint-disable-line functional/immutable-data
          .skip(skip)
          .limit(limit + 1) // +1 is used to check if there is more results
          .toArray();

        // logger.debug(`profilesArray: ${profilesArray.length}`);
        // logger.debug(`limit: ${limit}`);
        const hasNext = profilesArray.length > limit;
        // logger.debug(`hasNext: ${hasNext}`);

        const resultArray = hasNext ? profilesArray.slice(0, -1) : profilesArray;
        const nextOffset = skip + limit;
        debug(`Query result: ${resultArray.length > 0 ? 'Found!' : 'Not found!'}`);
        debugDev(`${JSON.stringify(resultArray)}`);
        emitter.emit('profiles', resultArray);

        if (hasNext && getAll) {
          return handleProfileQuery(getAll, nextOffset);
        }

        if (hasNext && !getAll) {
          return emitter.emit('end', nextOffset);
        }

        return emitter.emit('end', false);
      } catch (error) {
        emitter.emit('error', error);
      }
    }
  }

  // MARK: Create or Modify Profile
  async function createOrModifyProfile({id, payload}) {
    try {
      const clean = sanitize(id);
      const profile = await operator.findOne({id: clean});

      if (profile) {
        debug('Updating profile');
        await operator.findOneAndUpdate({id}, {$set: {...payload, id}});
        return {status: httpStatus.NO_CONTENT};
      }

      debug('Creating profile');
      await operator.insertOne({...payload, id});
      return {status: httpStatus.CREATED};
    } catch (error) {
      debug('Profile handling error');
      throw error;
    }
  }

  // MARK: Read Profile
  async function readProfile({id}) {
    const clean = sanitize(id);
    debug(`Read profile: ${clean}`);
    const doc = await operator.findOne({id: clean}, {projection: {_id: 0}});

    if (doc) {
      return doc;
    }

    throw new ApiError(httpStatus.NOT_FOUND, 'Profile not found');
  }

  // MARK: Remove Profile
  async function removeProfile({id}) {
    const clean = sanitize(id);
    debug(`Preparing to remove profile @ id: ${clean}`);
    const result = await operator.deleteOne({id: clean});
    // logger.debug(JSON.stringify(result));

    const {acknowledged, deletedCount} = result;
    // logger.debug(`acknowledged: ${acknowledged === true}`);
    // logger.debug(`deletedCount 1: ${deletedCount === 1}`);
    // logger.debug(`deletedCount 0: ${deletedCount === 0}`);

    if (acknowledged === true && deletedCount === 1) {
      debugDev(`Profile removed`);
      return true;
    }

    if (acknowledged === true && deletedCount === 0) {
      debugDev(`Profile for remove not found `);
      throw new ApiError(httpStatus.NOT_FOUND, 'Profile not found');
    }

    debugDev(`Removing profile mongo error`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Error while removing profile');
  }

  async function closeClient() {
    debug(`Closing client`);
    await client.close();
  }
}
