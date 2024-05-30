/* eslint-disable max-lines */


import {MongoClient} from 'mongodb';
import {createLogger} from '@natlibfi/melinda-backend-commons';
import {Error as ApiError} from '@natlibfi/melinda-commons';
import moment from 'moment';
import sanitize from 'mongo-sanitize';
import {hasPermission} from './utils';
import {BLOB_STATE, BLOB_UPDATE_OPERATIONS} from './constants';
import httpStatus from 'http-status';


export default async function (mongoUrl) {
  const logger = createLogger();

  // Connect to mongo (MONGO)
  const client = await MongoClient.connect(mongoUrl, {useNewUrlParser: true, useUnifiedTopology: true});
  const db = client.db('db');

  return {readBlob, updateBlob};

  // MARK: Read Blob
  async function readBlob({id, user}) {
    const clean = sanitize(id);
    logger.debug(`Read blob: ${clean}`);
    const doc = await db.collection('blobmetadatas').findOne({id: clean});

    if (doc) {
      const blob = formatBlobDocument(doc);
      const profile = await getProfile(blob.profile);
      if (hasPermission(user.roles.groups, profile.groups)) {
        return blob;
      }

      throw new ApiError(httpStatus.FORBIDDEN, 'Blob read permission error');
    }

    throw new ApiError(httpStatus.NOT_FOUND, 'Blob not found');

    function formatBlobDocument(doc) {
      const blob = doc._doc;

      return Object.keys(blob).reduce((acc, key) => {
        if ((/^_+/u).test(key)) {
          return acc;
        }

        if (key === 'creationTime' || key === 'modificationTime') {
          const value = moment(blob[key]).format();
          return {...acc, [key]: value};
        }

        return {...acc, [key]: blob[key]};
      }, {});
    }
  }

  // MARK: Update Blob
  async function updateBlob({id, payload, user}) {
    const clean = sanitize(id);
    logger.debug(`Update blob: ${clean}`);
    const blob = await db.collection('blobmetadatas').findOne({id: clean});

    if (blob) {
      const bgroups = await getProfile(blob.profile);
      if (hasPermission(user.roles.groups, bgroups.groups)) {
        const {op} = payload;
        if (op) {
          const doc = await getUpdateDoc(op);

          const updateIfNotInStates = [BLOB_STATE.TRANSFORMATION_FAILED, BLOB_STATE.ABORTED, BLOB_STATE.PROCESSED];
          if (updateIfNotInStates.includes(blob.state)) {
            throw new ApiError(httpStatus.CONFLICT);
          }

          const {numberOfRecords, failedRecords, importResults} = blob.processingInfo;
          if (op === BLOB_UPDATE_OPERATIONS.recordProcessed && numberOfRecords <= failedRecords.length + importResults.length) { // eslint-disable-line functional/no-conditional-statements
            throw new ApiError(httpStatus.CONFLICT);
          }

          const {modifiedCount} = await db.collection('blobmetadatas').updateOne({clean}, doc);

          if (modifiedCount === 0) { // eslint-disable-line functional/no-conditional-statements
            throw new ApiError(httpStatus.CONFLICT);
          }

          /*if (melindaApiOptions.melindaApiUrl && doc.correlationId) {
            await melindaApiClient.setBulkStatus(doc.correlationId, QUEUE_ITEM_STATE.ABORT);
            return;
          }*/

          return;
        }

        throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Blob update operation error');
      }

      throw new ApiError(httpStatus.FORBIDDEN, 'Blob update/abort permission error');
    }

    throw new ApiError(httpStatus.NOT_FOUND, 'Blob not found');

    // MARK: Update - Get update doc
    function getUpdateDoc(op) {
      const {
        abort, recordProcessed, transformationFailed,
        updateState, transformedRecord, addCorrelationId
      } = BLOB_UPDATE_OPERATIONS;

      logger.debug(`Update blob: ${op}`);

      if (op === updateState) {
        const {state} = payload;
        logger.debug(`State update to ${state}`);

        if ([
          BLOB_STATE.PROCESSED,
          BLOB_STATE.PROCESSING,
          BLOB_STATE.PROCESSING_BULK,
          BLOB_STATE.PENDING_TRANSFORMATION,
          BLOB_STATE.TRANSFORMATION_IN_PROGRESS,
          BLOB_STATE.TRANSFORMED
        ].includes(state)) {
          return {state, modificationTime: moment()};
        }

        throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Blob update state error');
      }

      if (op === abort) {
        const {correlationId} = blob;

        if (correlationId === '') {
          return {
            state: BLOB_STATE.ABORTED,
            modificationTime: moment()
          };
        }

        return {
          correlationId,
          state: BLOB_STATE.ABORTED,
          modificationTime: moment()
        };
      }

      if (op === transformationFailed) {
        logger.debug(`case: ${op}, Error: ${payload.error}`);
        return {
          state: BLOB_STATE.TRANSFORMATION_FAILED,
          modificationTime: moment(),
          $set: {
            'processingInfo.transformationError': payload.error
          }
        };
      }

      if (op === transformedRecord) {
        if (payload.error) {
          payload.error.timestamp = moment().format(); // eslint-disable-line new-cap, functional/immutable-data
          return {
            modificationTime: moment(),
            $push: {
              'processingInfo.failedRecords': payload.error
            },
            $inc: {
              'processingInfo.numberOfRecords': 1
            }
          };
        }

        return {
          modificationTime: moment(),
          $inc: {
            'processingInfo.numberOfRecords': 1
          }
        };
      }

      if (op === recordProcessed) {
        return {
          modificationTime: moment(),
          $push: {
            'processingInfo.importResults': {
              status: payload.status,
              metadata: payload.metadata
            }
          }
        };
      }

      if (op === addCorrelationId) {
        logger.debug(`case: ${op}, CorrelationId: ${payload.correlationId}`);
        return {
          modificationTime: moment(),
          correlationId: payload.correlationId
        };
      }

      logger.error(`Blob update case '${op}' was not found`);
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Blob update operation error');
    }
  }

  // MARK: Get profile
  async function getProfile(id) {
    const profile = await db.collection('profiles').findOne({id});
    if (profile) {
      return profile;
    }

    return false;
  }
}
