/* eslint-disable max-lines */
import createDebugLogger from 'debug';
import httpStatus from 'http-status';
import sanitize from 'mongo-sanitize';
import {MongoClient, GridFSBucket, MongoDriverError} from 'mongodb';

import {createLogger} from '@natlibfi/melinda-backend-commons';
import {Error as ApiError} from '@natlibfi/melinda-commons';

import {BLOB_STATE, BLOB_UPDATE_OPERATIONS} from './constants';
// import {v4 as uuid} from 'uuid';

export async function createMongoOperator(mongoUrl, {db = 'db', collection = 'blobmetadatas'} = {db: 'db', collection: 'blobmetadatas'}) {
  const logger = createLogger();
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:utils');
  const debugDev = createDebugLogger('@natlibfi/melinda-record-import-commons:utils:dev');

  // Connect to mongo (MONGO)
  const client = await MongoClient.connect(mongoUrl);
  const dbConnection = client.db(db);
  const operator = dbConnection.collection(collection);
  const gridFSBucket = new GridFSBucket(dbConnection, {bucketName: collection});

  return {createBlob, readBlob, readBlobContent, updateBlob, removeBlob, removeBlobContent, closeClient};

  // MARK: Create Blob
  async function createBlob(content, stream) {
    const blob = assembleBlob(content);
    try {
      const result = await operator.insertOne(blob);
      if (result.acknowledged) {
        logger.info(`New BLOB for ${content.profile}, id: ${blob.id} has been made`);
        debug(`Uploading blob content`);
        const upload = new Promise((resolve, reject) => {
          const outputStream = gridFSBucket.openUploadStream(blob.id);

          stream
            .on('error', reject)
            .on('data', chunk => outputStream.write(chunk))
            .on('end', () => outputStream.end(undefined, undefined, () => {
              resolve();
            }));
        });

        await Promise.all([upload]);
        debug(`Blob content uploaded`);
        return blob.id;
      }

      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Blob creation error!');
    } catch (error) {
      const errorMessage = error.payload || error.message || '';
      logger.error(error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Mongo errored: ${errorMessage}`);
    }

    function assembleBlob({id, profile, contentType, date}) {
      return {
        id,
        correlationId: '',
        profile,
        cataloger: '',
        notificationEmail: '',
        contentType,
        state: BLOB_STATE.UPLOADING,
        creationTime: new Date(date).toISOString(),
        modificationTime: new Date(date).toISOString(),
        processingInfo: {
          transformationError: {},
          numberOfRecords: 0,
          failedRecords: [],
          importResults: []
        }
      };
    }
  }

  // MARK: Read Blob
  async function readBlob({id}) {
    const clean = sanitize(id);
    debug(`Read blob: ${clean}`);
    const doc = await operator.findOne({id: clean});

    if (doc) {
      return formatBlobDocument(doc);
    }

    throw new ApiError(httpStatus.NOT_FOUND, 'Blob not found');

    function formatBlobDocument(doc) {
      const blob = doc;
      return Object.keys(blob).reduce((acc, key) => {
        if ((/^_+/u).test(key)) {
          return acc;
        }

        if (key === 'creationTime' || key === 'modificationTime') {
          const value = new Date(blob[key]).toISOString();
          return {...acc, [key]: value};
        }

        return {...acc, [key]: blob[key]};
      }, {});
    }
  }

  // MARK: Read Blob Content
  function readBlobContent({id}) {
    debug(`Forming stream from blob ${id}`);
    try {
      const clean = sanitize(id);
      // Return content stream

      return gridFSBucket.openDownloadStreamByName(clean);
    } catch (error) {
      const errorMessage = error.payload || error.message || '';
      logger.error(error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Mongo errored: ${errorMessage}`);
    }
  }

  // MARK: Update Blob
  async function updateBlob({id, payload}) {
    const clean = sanitize(id);
    debug(`Update blob: ${clean}`);
    const blob = await operator.findOne({id: clean});
    debugDev(blob);
    if (blob) {
      const {op, test = false} = payload;
      if (op) {
        const doc = await getUpdateDoc(op, test);

        const updateIfNotInStates = [BLOB_STATE.TRANSFORMATION_FAILED, BLOB_STATE.ABORTED, BLOB_STATE.PROCESSED];
        if (updateIfNotInStates.includes(blob.state)) {
          throw new ApiError(httpStatus.CONFLICT, 'Not valid blob state for update');
        }

        const {numberOfRecords, failedRecords, importResults} = blob.processingInfo;
        if (op === BLOB_UPDATE_OPERATIONS.recordProcessed && numberOfRecords <= failedRecords.length + importResults.length) { // eslint-disable-line functional/no-conditional-statements
          throw new ApiError(httpStatus.CONFLICT, 'Invalid blob record count');
        }

        debugDev(doc);
        const {modifiedCount} = await operator.findOneAndUpdate({id: clean}, doc, {projection: {_id: 0}, returnNewDocument: false});

        if (modifiedCount === 0) { // eslint-disable-line functional/no-conditional-statements
          throw new ApiError(httpStatus.CONFLICT, 'No change');
        }

        return;
      }

      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Blob update operation error');
    }

    throw new ApiError(httpStatus.NOT_FOUND, 'Blob not found');

    // MARK: Update - Get update doc
    function getUpdateDoc(op, test) {
      const nowDate = test ? new Date('2024-07-31T06:00:00.000Z').toISOString() : new Date().toISOString();
      const {
        abort, recordProcessed, transformationFailed,
        updateState, transformedRecord, addCorrelationId
      } = BLOB_UPDATE_OPERATIONS;

      debug(`Update blob operation: ${op}`);

      if (op === updateState) {
        const {state} = payload;
        debug(`State update to ${state}`);

        if ([
          BLOB_STATE.PROCESSED,
          BLOB_STATE.PROCESSING,
          BLOB_STATE.PROCESSING_BULK,
          BLOB_STATE.PENDING_TRANSFORMATION,
          BLOB_STATE.TRANSFORMATION_IN_PROGRESS,
          BLOB_STATE.TRANSFORMED
        ].includes(state)) {
          return {$set: {state, modificationTime: nowDate}};
        }

        throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Blob update state error');
      }

      if (op === abort) {
        return {
          $set: {
            state: BLOB_STATE.ABORTED,
            modificationTime: nowDate
          }
        };
      }

      if (op === transformationFailed) {
        debugDev(`Error: ${payload.error}`);
        return {
          $set: {
            state: BLOB_STATE.TRANSFORMATION_FAILED,
            modificationTime: nowDate,
            'processingInfo.transformationError': payload.error
          }
        };
      }

      if (op === transformedRecord) {
        if (payload.error) {
          payload.error.timestamp = nowDate; // eslint-disable-line new-cap, functional/immutable-data
          return {
            $set: {
              modificationTime: nowDate
            },
            $push: {
              'processingInfo.failedRecords': payload.error
            },
            $inc: {
              'processingInfo.numberOfRecords': 1
            }
          };
        }

        return {
          $set: {
            modificationTime: nowDate
          },
          $inc: {
            'processingInfo.numberOfRecords': 1
          }
        };
      }

      if (op === recordProcessed) {
        return {
          $set: {
            modificationTime: nowDate
          },
          $push: {
            'processingInfo.importResults': {
              status: payload.status,
              metadata: payload.metadata
            }
          }
        };
      }

      if (op === addCorrelationId) {
        debug(`CorrelationId: ${payload.correlationId}`);
        return {
          $set: {
            modificationTime: nowDate,
            correlationId: payload.correlationId
          }
        };
      }

      logger.error(`Blob update case '${op}' was not found`);
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Blob update operation error');
    }
  }

  // MARK: Remove Blob
  async function removeBlob({id}) {
    const clean = sanitize(id);
    debug(`Preparing to remove blob @ id: ${clean}`);

    try {
      const noContent = await removeBlobContent({id});
      if (noContent) {
        debug(`Removing blob id:${JSON.stringify(clean)}`);
        await operator.deleteOne({id: clean});
        return true;
      }
    } catch (err) {
      debugDev('removeBlob handing error');
      if (err instanceof MongoDriverError) {
        if (err.message.indexOf('File not found for id') !== -1) {
          debug(`Removing blob id:${JSON.stringify(clean)}`);
          await operator.deleteOne({id: clean});
          return true;
        }
        logger.error(err.message);
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, err.message);
      }
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, err.message);
    }
  }

  // MARK: Remove Blob Content
  async function removeBlobContent({id}) {
    debug(`Checkking blob content, id: ${id}`);
    const clean = sanitize(id);

    const result = await dbConnection.collection(`${collection}.files`).findOne({filename: clean}); // njsscan-ignore: node_nosqli_injection
    debugDev(`blob removeContent check: result ${JSON.stringify(result)}`);

    if (result) {
      debug(`Content found and removed`);
      await gridFSBucket.delete(result._id);
      return true;
    }

    debug(`No content found`);
    return true;
  }

  async function closeClient() {
    debug(`Closing client`);
    await client.close();
  }
}
