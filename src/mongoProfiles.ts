
import createDebugLogger from 'debug';
import httpStatus from 'http-status';
import sanitize from 'mongo-sanitize';
import {MongoClient} from 'mongodb';
import {EventEmitter} from 'events';

// import {createLogger} from '@natlibfi/melinda-backend-commons';
import {Error as ApiError} from '@natlibfi/melinda-commons';

import {generateProfileQuery} from './utils.ts';
import type {ProfileQuery, UserInfo} from './utils.ts';

// MARK: Type definitions

export interface ProfileDocument {
  id: string;
  [key: string]: unknown;
}

export interface QueryProfileParams {
  limit?: number;
  skip?: number;
  getAll?: boolean;
  id?: string;
  group?: string;
}

export interface CreateOrModifyProfileParams {
  id: string;
  payload: UserInfo;
}

export interface ReadProfileParams {
  id: string;
}

export interface RemoveProfileParams {
  id: string;
}

export interface QueryProfileEmitter extends EventEmitter {
  on(event: 'profiles', listener: (profiles: Record<string, unknown>[]) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'end', listener: (hasNext: false) => void): this;
}

export interface MongoProfilesOperator {
  queryProfile(params: QueryProfileParams): QueryProfileEmitter;
  createOrModifyProfile(params: CreateOrModifyProfileParams): Promise<{status: number}>;
  readProfile(params: ReadProfileParams): Promise<Record<string, unknown>>;
  removeProfile(params: RemoveProfileParams): Promise<boolean>;
  closeClient(): Promise<void>;
}

export async function createMongoProfilesOperator(mongoUrl: string, db = 'db'): Promise<MongoProfilesOperator> {
  // const logger = createLogger();
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:mongoProfiles');
  const debugDev = createDebugLogger('@natlibfi/melinda-record-import-commons:mongoProfiles:dev');

  // Connect to mongo (MONGO)
  const client = await MongoClient.connect(mongoUrl);
  const dbConnection = client.db(db);
  const operator = dbConnection.collection<ProfileDocument>('profiles');

  return {queryProfile, createOrModifyProfile, readProfile, removeProfile, closeClient};

  // MARK: Query Profile
  function queryProfile(params: QueryProfileParams = {}): QueryProfileEmitter {
    debug(`Querying: ${JSON.stringify(params)}`);
    const emitter = new EventEmitter() as QueryProfileEmitter;
    const {limit = 100, skip = 0, getAll = true, ...rest} = params;

    const query = generateProfileQuery(rest) as ProfileQuery;

    handleProfileQuery(getAll, skip);

    return emitter;

    async function handleProfileQuery(getAll: boolean, skip: number): Promise<void> {
      try {
        // .find(<query>, <projection>, <options>)
        const profilesArray = await operator.find(query as ProfileDocument, {projection: {_id: 0}})
          .skip(skip)
          .limit(limit + 1) // +1 is used to check if there is more results
          .toArray();

        const hasNext = profilesArray.length > limit;

        const resultArray = hasNext ? profilesArray.slice(0, -1) : profilesArray;
        const nextOffset = skip + limit;
        debug(`Query result: ${resultArray.length > 0 ? 'Found!' : 'Not found!'}`);
        debugDev(`${JSON.stringify(resultArray)}`);
        emitter.emit('profiles', resultArray);

        if (hasNext && getAll) {
          await handleProfileQuery(getAll, nextOffset);
          return;
        }

        if (hasNext && !getAll) {
          await emitter.emit('end', false);
          return;
        }

        emitter.emit('end', false);
        return;
      } catch (error) {
        emitter.emit('error', error);
      }
    }
  }

  // MARK: Create or Modify Profile
  async function createOrModifyProfile({id, payload}: CreateOrModifyProfileParams) {
    try {
      const clean = sanitize(id);
      const profile = await operator.findOne({id: clean});

      if (profile) {
        debug('Updating profile');
        await operator.findOneAndUpdate({id: clean}, {$set: {...payload, id: clean}});
        return {status: httpStatus['NO_CONTENT'] as number};
      }

      debug('Creating profile');
      await operator.insertOne({...payload, id: clean});
      return {status: httpStatus['CREATED'] as number};
    } catch (error) {
      debug('Profile handling error');
      throw error;
    }
  }

  // MARK: Read Profile
  async function readProfile({id}: ReadProfileParams) {
    const clean = sanitize(id);
    debug(`Read profile: ${clean}`);
    const doc = await operator.findOne({id: clean}, {projection: {_id: 0}});

    if (doc) {
      return doc;
    }

    throw new ApiError(httpStatus['NOT_FOUND'] as number, 'Profile not found');
  }

  // MARK: Remove Profile
  async function removeProfile({id}: RemoveProfileParams): Promise<boolean> {
    const clean = sanitize(id);
    debug(`Preparing to remove profile @ id: ${clean}`);
    const result = await operator.deleteOne({id: clean});

    const {acknowledged, deletedCount} = result;

    if (acknowledged === true && deletedCount === 1) {
      debugDev(`Profile removed`);
      return true;
    }

    if (acknowledged === true && deletedCount === 0) {
      debugDev(`Profile for remove not found `);
      throw new ApiError(httpStatus['NOT_FOUND'] as number, 'Profile not found');
    }

    debugDev(`Removing profile mongo error`);
    throw new ApiError(httpStatus['INTERNAL_SERVER_ERROR'] as number, 'Error while removing profile');
  }

  async function closeClient(): Promise<void> {
    debug(`Closing client`);
    await client.close();
  }
}
