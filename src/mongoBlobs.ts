
import createDebugLogger from 'debug';
import httpStatus from 'http-status';
import sanitize from 'mongo-sanitize';
import {MongoClient, GridFSBucket} from 'mongodb';
import {EventEmitter} from 'events';

import {createLogger} from '@natlibfi/melinda-commons';
import {Error as ApiError} from '@natlibfi/melinda-commons';

import {BLOB_STATE, BLOB_UPDATE_OPERATIONS} from './constants.ts';
import {generateBlobQuery} from './utils.ts';
import type {UserInfo} from './utils.ts';
import type {Readable} from 'stream';

// MARK: Type definitions

export interface BlobDocument {
  id: string;
  correlationId: string;
  profile: string;
  cataloger: string;
  notificationEmail: string;
  contentType: string;
  state: keyof typeof BLOB_STATE;
  creationTime: string;
  modificationTime: string;
  processingInfo: {
    transformationError: Record<string, unknown>;
    numberOfRecords: number;
    failedRecords: unknown[];
    importResults: unknown[];
  };
}

export interface QueryBlobParams {
  limit?: string | number;
  skip?: string | number;
  getAll?: boolean;
  profile?: string;
  contentType?: string;
  state?: keyof typeof BLOB_STATE;
  creationTime?: string;
  modificationTime?: string;
}

export interface CreateBlobParams {
  id: string;
  profile: string;
  contentType: string;
  date: string;
}

export interface ReadBlobParams {
  id: string;
}

export interface UpdateBlobPayload {
  op: keyof typeof BLOB_UPDATE_OPERATIONS;
  state?: keyof typeof BLOB_STATE;
  error?: string | Record<string, unknown>;
  incNumberOfRecords?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  cataloger?: string;
  notificationEmail?: string;
}

export interface UpdateBlobParams {
  id: string;
  payload: UpdateBlobPayload;
}

export interface RemoveBlobParams {
  id: string;
}


export interface QueryBlobEmitter extends EventEmitter {
  on(event: 'blobs', listener: (blobs: BlobDocument[]) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'end', listener: (nextOffset: string | false) => void): this;
}

export interface MongoBlobsOperator {
  queryBlob(params: QueryBlobParams, user?: UserInfo): QueryBlobEmitter;
  createBlob(params: CreateBlobParams, stream: Readable): Promise<string>;
  readBlob(params: ReadBlobParams): Promise<BlobDocument | void>;
  readBlobContent(params: ReadBlobParams): Readable;
  updateBlob(params: UpdateBlobParams): Promise<void>;
  removeBlob(params: RemoveBlobParams): Promise<void>;
  removeBlobContent(params: RemoveBlobParams): Promise<void>;
  closeClient(): Promise<void>;
}

export async function createMongoBlobsOperator(mongoUrl: string, db = 'db'): Promise<MongoBlobsOperator> {
  const logger = createLogger();
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:mongoBlobs');
  const debugDev = debug.extend('dev');

  // Connect to mongo (MONGO)
  const client = await MongoClient.connect(mongoUrl);
  const dbConnection = client.db(db);
  const operator = dbConnection.collection<BlobDocument>('blobmetadatas');
  const gridFSBucket = new GridFSBucket(dbConnection, {bucketName: 'blobmetadatas'});

  return {queryBlob, createBlob, readBlob, readBlobContent, updateBlob, removeBlob, removeBlobContent, closeClient};

  // MARK: Query Blob
  /**
   * Query blobs
   *
   * @param {Object} params object: limit, skip, getAll, sort, profile, id, correlationId, state, cretionTime, modificationTime
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
  function queryBlob(params: QueryBlobParams, user?: UserInfo): QueryBlobEmitter {
    debugDev(`Mongo operator query blob`);
    const emitter = new EventEmitter() as QueryBlobEmitter;
    const limit = parseInt(String(params.limit ?? 100), 10);
    const skip = parseInt(String(params.skip ?? 0), 10);
    const {getAll = true, ...rest} = params;

    const query = generateBlobQuery(rest, user);
    debugDev(`Query: ${JSON.stringify(query)}`);

    handleBlobQuery(query, getAll, skip);

    return emitter;

    async function handleBlobQuery(query, getAll: boolean, skip: number): Promise<void> {
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
          await handleBlobQuery(query, getAll, nextOffset);
          return;
        }

        if (hasNext && !getAll) {
          emitter.emit('end', nextOffset);
          return;
        }

        emitter.emit('end', false);
        return;
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
  async function createBlob(params: CreateBlobParams, stream: Readable): Promise<string> {
    const blob = assembleBlob(params);
    try {
      const result = await operator.insertOne(blob);
      if (result.acknowledged) {
        debug(`New BLOB for ${params.profile}, id: ${blob.id} has been made`);
        debug(`Uploading blob content`);
        return new Promise<string>((resolve, reject) => {
          const uploadStream = gridFSBucket.openUploadStream(blob.id);
          stream.pipe(uploadStream);
          uploadStream
            .on('error', reject)
            .on('finish', () => {
              resolve(blob.id)
            });
        });
      }

      throw new ApiError(httpStatus['INTERNAL_SERVER_ERROR'] as number, 'Blob creation error!');
    } catch (error: unknown) {
      const errorMessage = (error instanceof ApiError && (error.payload || error.message)) || (error instanceof Error ? error.message : '') || '';
      logger.error(error);
      throw new ApiError(httpStatus['INTERNAL_SERVER_ERROR'] as number, `Mongo errored: ${errorMessage}`);
    }

    function assembleBlob({id, profile, contentType, date}: CreateBlobParams): BlobDocument {
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
  async function readBlob({id}): Promise<BlobDocument | void> {
    const sanitizedId = sanitize(id);
    debug(`Read blob: ${sanitizedId}`);
    const doc = await operator.findOne({id: sanitizedId});

    if (doc) {
      return formatBlobDocument(doc);
    }

    throw new ApiError(httpStatus['NOT_FOUND'] as number, 'Blob not found');

    function formatBlobDocument(doc: BlobDocument) {
      const formatted: Partial<BlobDocument> = {};
      for (const key of Object.keys(doc)) {
        if (/^_/.test(key)) continue;

        const value = doc[key];

        if ((key === 'creationTime' || key === 'modificationTime') && value !== null) {
          formatted[key] = new Date(doc[key]).toISOString();
        } else {
          formatted[key] = value;
        }
      }

      return formatted as BlobDocument;
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
      throw new ApiError(httpStatus['NOT_FOUND'] as number, 'Blob not found');
    }
    // debugDev(blob);
    const {op, ...rest} = payload;

    if (!op) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Blob update operation error');
    }

    const updateIfNotInStates = [BLOB_STATE.TRANSFORMATION_FAILED, BLOB_STATE.ABORTED, BLOB_STATE.PROCESSED];
    if (updateIfNotInStates.some(state => state === blob.state)) {
      throw new ApiError(httpStatus['CONFLICT'] as number, 'Not valid blob state for update');
    }

    const {numberOfRecords, failedRecords, importResults} = blob.processingInfo;
    if (op === BLOB_UPDATE_OPERATIONS.recordProcessed && numberOfRecords < failedRecords.length + importResults.length) {
      throw new ApiError(httpStatus['CONFLICT'] as number, 'Invalid blob record count');
    }

    const doc = getUpdateDoc(op, rest);

    // debugDev(doc);
    const {ok, lastErrorObject} = await operator.findOneAndUpdate({id: sanitizedId}, doc, {projection: {_id: 0}, includeResultMetadata: true});
    if (ok === 0) {
      console.log(lastErrorObject);
      throw new ApiError(httpStatus['CONFLICT'] as number, 'No change');
    }

    return;

    // MARK: Update - Get update doc
    function getUpdateDoc(op, updatePayload) {
      const nowDate = new Date().toISOString();

      debug(`Update blob operation: ${op}`);
      debugDev(`Update blob payload: ${JSON.stringify(updatePayload)}`);

      if (op === BLOB_UPDATE_OPERATIONS.updateState) {
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

        throw new ApiError(httpStatus['UNPROCESSABLE_ENTITY'] as number, 'Blob update state error: invalid state');
      }

      if (op === BLOB_UPDATE_OPERATIONS.abort) {
        return {
          $set: {
            state: BLOB_STATE.ABORTED,
            modificationTime: nowDate
          }
        };
      }

      if (op === BLOB_UPDATE_OPERATIONS.resetImportResults) {
        return {
          $set: {
            'processingInfo.importResults': [],
            modificationTime: nowDate
          }
        };
      }

      if (op === BLOB_UPDATE_OPERATIONS.transformationFailed) {
        return {
          $set: {
            state: BLOB_STATE.TRANSFORMATION_FAILED,
            modificationTime: nowDate,
            'processingInfo.transformationError': updatePayload.error
          }
        };
      }

      if (op === BLOB_UPDATE_OPERATIONS.transformedRecord) {
        const incNumberOfRecords = updatePayload.incNumberOfRecords ?? true;
        if (updatePayload.error) {
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

      if (op === BLOB_UPDATE_OPERATIONS.recordProcessed) {
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

      if (op === BLOB_UPDATE_OPERATIONS.addCorrelationId) {
        return {
          $set: {
            modificationTime: nowDate,
            correlationId: updatePayload.correlationId
          }
        };
      }

      if (op === BLOB_UPDATE_OPERATIONS.setCataloger) {
        return {
          $set: {
            modificationTime: nowDate,
            cataloger: updatePayload.cataloger
          }
        };
      }

      if (op === BLOB_UPDATE_OPERATIONS.setNotificationEmail) {
        return {
          $set: {
            modificationTime: nowDate,
            notificationEmail: updatePayload.notificationEmail
          }
        };
      }

      logger.error(`Blob update case '${op}' was not found`);
      throw new ApiError(httpStatus['UNPROCESSABLE_ENTITY'] as number, 'Blob update operation error');
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
    } catch (error: unknown) {
      if (error instanceof Error) {
        debugDev('removeBlob handing error');
        throw new ApiError(httpStatus['INTERNAL_SERVER_ERROR'] as number, error.message);
      }
      throw error;
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
