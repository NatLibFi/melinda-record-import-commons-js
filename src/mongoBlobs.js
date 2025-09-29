
import createDebugLogger from 'debug';
import httpStatus from 'http-status';
import sanitize from 'mongo-sanitize';
import {MongoClient, GridFSBucket} from 'mongodb';
import {EventEmitter} from 'events';

import {createLogger} from '@natlibfi/melinda-backend-commons';
import {Error as ApiError} from '@natlibfi/melinda-commons';

import {BLOB_STATE, BLOB_UPDATE_OPERATIONS} from './constants.js';
import {generateBlobQuery} from './utils.js';

export async function createMongoBlobsOperator(mongoUrl, db = 'db') {
  const logger = createLogger();
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:mongoBlobs');
  const debugDev = debug.extend('dev');

  // Connect to mongo (MONGO)
  const client = await MongoClient.connect(mongoUrl);
  const dbConnection = client.db(db);
  const operator = dbConnection.collection('blobmetadatas');
  const gridFSBucket = new GridFSBucket(dbConnection, {bucketName: 'blobmetadatas'});

  return {queryBlob, createBlob, readBlob, readBlobContent, updateBlob, removeBlob, removeBlobContent, closeClient};

  // MARK: Query Blob
  /**
   * Query blobs
   *
   * @param {Object} params object: limit, skip, sort, profiles, id, correlationId, state, cretionTime, modificationTime
   * @param {string|integer} params.limit Mongo limit results to n results
   * @param {string|integer} params.skip Mongo skip n query results
   * @param {boolean} params.getAll Mongo get all query results
   * @param {string} params.profile
   * @param {string} params.contentType Stream data content-type
   * @param {string} params.state Blob state
   * @param {string} params.cretionTime format '2024-08-30' or '2024-08-30T12:00:00.000Z' or '2024-08-30,2024-09-01'
   * @param {string} params.modificationTime format '2024-08-30' or '2024-08-30T12:00:00.000Z' or '2024-08-30,2024-09-01'
   * @returns {EventEmitter} Emits event on blobs, error and end
   */
  function queryBlob(params, user = false) {
    debugDev(`Mongo operator query blob`);
    const emitter = new EventEmitter();
    const limit = parseInt(params.limit || 100, 10);
    const skip = parseInt(params.skip || 0, 10);
    const {getAll = true, ...rest} = params;

    const query = generateBlobQuery(rest, user);
    debugDev(`Query: ${JSON.stringify(query)}`);

    handleBlobQuery(getAll, skip);

    return emitter;

    async function handleBlobQuery(getAll, skip) {
      try {
        // .find(<query>, <projection>, <options>)
        const blobsArray = await operator.find(query, {projection: {_id: 0}})
          .skip(skip)
          .limit(limit + 1)
          .toArray();

        // logger.debug(`blobsArray: ${blobsArray.length}`);
        // logger.debug(`limit: ${limit}`);
        const hasNext = blobsArray.length > limit;
        // logger.debug(`hasNext: ${hasNext}`);

        const resultArray = hasNext ? blobsArray.slice(0, -1) : blobsArray;
        const nextOffset = skip + limit;
        debugDev(`Query result: ${resultArray.length > 0 ? 'Found!' : 'Not found!'}`);
        // debugDev(`${JSON.stringify(resultArray.slice(0,3))}`);
        emitter.emit('blobs', resultArray);

        if (hasNext && getAll) {
          return handleBlobQuery(getAll, nextOffset);
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

  // MARK: Create Blob

  /**
   * Create Blob
   *
   * @async
   * @param {Object} params
   * @param {uuid4} params.id String uuid4 identifier
   * @param {string} params.profile
   * @param {string} params.contentType Stream data content-type
   * @param {string} params.date Creation time date in string format '2024-08-30T12:00:00.000Z'
   * @param {stream} stream
   * @returns {uuid4} uuid4 string
   */
  async function createBlob(params, stream) {
    const blob = assembleBlob(params);
    try {
      const result = await operator.insertOne(blob);
      if (result.acknowledged) {
        debug(`New BLOB for ${params.profile}, id: ${blob.id} has been made`);
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
    const sanitizedId = sanitize(id);
    debug(`Read blob: ${sanitizedId}`);
    const doc = await operator.findOne({id: sanitizedId});

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
    const sanitizedId = sanitize(id);
    // Return content stream
    return gridFSBucket.openDownloadStreamByName(sanitizedId);
  }

  // MARK: Update Blob
  async function updateBlob({id, payload}) {
    const sanitizedId = sanitize(id);
    debug(`Update blob: ${sanitizedId}`);

    const blob = await operator.findOne({id: sanitizedId});
    debugDev(blob ? 'Blob found' : 'Blob not found');

    if (!blob) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Blob not found');
    }
    // debugDev(blob);
    const {op, ...rest} = payload;

    if (!op) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Blob update operation error');
    }

    const updateIfNotInStates = [BLOB_STATE.TRANSFORMATION_FAILED, BLOB_STATE.ABORTED, BLOB_STATE.PROCESSED];
    if (updateIfNotInStates.includes(blob.state)) {
      throw new ApiError(httpStatus.CONFLICT, 'Not valid blob state for update');
    }

    const {numberOfRecords, failedRecords, importResults} = blob.processingInfo;
    if (op === BLOB_UPDATE_OPERATIONS.recordProcessed && numberOfRecords < failedRecords.length + importResults.length) {
      throw new ApiError(httpStatus.CONFLICT, 'Invalid blob record count');
    }

    const doc = getUpdateDoc(op, rest);

    // debugDev(doc);
    const {modifiedCount} = await operator.findOneAndUpdate({id: sanitizedId}, doc, {projection: {_id: 0}, returnNewDocument: false});

    if (modifiedCount === 0) {
      throw new ApiError(httpStatus.CONFLICT, 'No change');
    }

    return;

    // MARK: Update - Get update doc
    function getUpdateDoc(op, updatePayload) {
      const nowDate = new Date().toISOString();
      const {
        abort, recordProcessed, transformationFailed,
        updateState, transformedRecord, addCorrelationId,
        setCataloger, setNotificationEmail, resetImportResults
      } = BLOB_UPDATE_OPERATIONS;

      debug(`Update blob operation: ${op}`);
      debugDev(`Update blob payload: ${JSON.stringify(updatePayload)}`);

      if (op === updateState) {
        const {state} = updatePayload;

        const validStatesToUpdate = [
          BLOB_STATE.PROCESSED,
          BLOB_STATE.PROCESSING,
          BLOB_STATE.PROCESSING_BULK,
          BLOB_STATE.PENDING_TRANSFORMATION,
          BLOB_STATE.TRANSFORMATION_IN_PROGRESS,
          BLOB_STATE.PENDING_LOOKUP,
          BLOB_STATE.PROCESSING_LOOKUP,
          BLOB_STATE.TRANSFORMED
        ];
        if (validStatesToUpdate.includes(state)) {
          return {$set: {state, modificationTime: nowDate}};
        }

        throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Blob update state error: invalid state');
      }

      if (op === abort) {
        return {
          $set: {
            state: BLOB_STATE.ABORTED,
            modificationTime: nowDate
          }
        };
      }

      if (op === resetImportResults) {
        return {
          $set: {
            'processingInfo.importResults': [],
            modificationTime: nowDate
          }
        };
      }

      if (op === transformationFailed) {
        return {
          $set: {
            state: BLOB_STATE.TRANSFORMATION_FAILED,
            modificationTime: nowDate,
            'processingInfo.transformationError': updatePayload.error
          }
        };
      }

      if (op === transformedRecord) {
        const incNumberOfRecords = updatePayload.incNumberOfRecords ?? true;
        if (updatePayload.error) {
          updatePayload.error.timestamp = nowDate;
          return {
            $set: {
              modificationTime: nowDate
            },
            $push: {
              'processingInfo.failedRecords': updatePayload.error
            },
            $inc: {
              'processingInfo.numberOfRecords': incNumberOfRecords ? 1 : 0
            }
          };
        }

        return {
          $set: {
            modificationTime: nowDate
          },
          $inc: {
            'processingInfo.numberOfRecords': incNumberOfRecords ? 1 : 0
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
              status: updatePayload.status,
              metadata: updatePayload.metadata
            }
          }
        };
      }

      if (op === addCorrelationId) {
        return {
          $set: {
            modificationTime: nowDate,
            correlationId: updatePayload.correlationId
          }
        };
      }

      if (op === setCataloger) {
        return {
          $set: {
            modificationTime: nowDate,
            cataloger: updatePayload.cataloger
          }
        };
      }

      if (op === setNotificationEmail) {
        return {
          $set: {
            modificationTime: nowDate,
            notificationEmail: updatePayload.notificationEmail
          }
        };
      }

      logger.error(`Blob update case '${op}' was not found`);
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Blob update operation error');
    }
  }

  // MARK: Remove Blob
  async function removeBlob({id}) {
    const sanitizedId = sanitize(id);
    debug(`Preparing to remove blob @ id: ${sanitizedId}`);

    try {
      await removeBlobContent({id});
      debug(`Removing blob id:${JSON.stringify(sanitizedId)}`);
      await operator.deleteOne({id: sanitizedId});
      return;
    } catch (err) {
      debugDev('removeBlob handing error');
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, err.message);
    }
  }

  // MARK: Remove Blob Content
  async function removeBlobContent({id}) {
    debug(`Checkking blob content, id: ${id}`);
    const sanitizedId = sanitize(id);

    const result = await dbConnection.collection('blobmetadatas.files').findOne({filename: sanitizedId}); // njsscan-ignore: node_nosqli_injection
    // debugDev(`blob removeContent check: result ${JSON.stringify(result)}`);

    if (result) {
      debug(`Content found and removed`);
      await gridFSBucket.delete(result._id);
      return;
    }

    debug(`No content found`);
    return;
  }

  async function closeClient() {
    debug(`Closing client`);
    await client.close();
  }
}
