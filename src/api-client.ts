import {EventEmitter} from 'events';
import createDebugLogger from 'debug';
import https from 'https';
import httpStatus from 'http-status';
import {URL} from 'url';
import {Readable} from 'stream';
import {Error as ApiError} from '@natlibfi/melinda-commons';
import {BLOB_UPDATE_OPERATIONS, BLOB_STATE, RECORD_IMPORT_STATE} from './constants.ts';
import {createServiceAuthoperator} from './keycloakAuthOperator.ts';

import type {KeycloakOptions, ServiceTokenOperator} from './keycloakAuthOperator.ts';

export interface ApiClientOptions {
  recordImportApiUrl: string;
  cfHeader?: string;
  userAgent?: string;
  allowSelfSignedApiCert?: boolean;
}

interface CreateBlobParams {
  blob: string;
  type: string;
  profile: string;
  duplex?: 'half' | undefined;
}

interface BlobContent {
  contentType: string;
  readStream: Readable;
}

interface CreateOrModifyProfileParams {
  id: string;
  payload: {
    groups: string[]
  };
}

interface SetCatalogerParams {
  id: string;
  cataloger: string;
}

interface SetNotificationEmailParams {
  id: string;
  notificationEmail: string;
}

interface SetTransformationFailedParams {
  id: string;
  error?: string;
}

interface SetCorrelationIdParams {
  id: string;
  correlationId: string;
}

interface SetRecordProcessedParams {
  id: string;
  status: keyof typeof RECORD_IMPORT_STATE;
  metadata: {
    id: string,
    title: string,
    standardIdentifiers?: string[],
    sourceIds?: string[],
    message: string,
    recordStatusNote: string
  }
}

interface SetTransformedRecordParams {
  id: string;
  error?: {
    failed: boolean,
    title: string,
    standardIdentifiers?: string[],
    sourceIds?: string[],
    message: string,
    timestamp: string
  };
}

interface UpdateStateParams {
  id: string;
  state: keyof typeof BLOB_STATE;
}

/* eslint-disable no-unused-vars,@typescript-eslint/no-explicit-any */
export interface ApiClient {
  getBlobs: (query?: {getAll: boolean;}) => EventEmitter;
  createBlob: (params: CreateBlobParams) => Promise<string>;
  getBlobMetadata: (params: {id: string}) => Promise<unknown>;
  getBlobContent: (params: {id: string}) => Promise<BlobContent>;
  deleteBlob: (params: {id: string}) => Promise<ReadableStream<any> | null>;
  deleteBlobContent: (params: {id: string}) => Promise<ReadableStream<any> | null>;
  getProfile: (params: {id: string}) => Promise<unknown>;
  deleteProfile: (params: {id: string}) => Promise<void>;
  createOrModifyProfile: (params: CreateOrModifyProfileParams) => Promise<void>;
  queryProfiles: () => Promise<unknown>;
  setCataloger: (params: SetCatalogerParams) => Promise<void>;
  setNotificationEmail: (params: SetNotificationEmailParams) => Promise<void>;
  setTransformationFailed: (params: SetTransformationFailedParams) => Promise<void>;
  setCorrelationId: (params: SetCorrelationIdParams) => Promise<void>;
  setRecordProcessed: (params: SetRecordProcessedParams) => Promise<void>;
  setTransformedRecord: (params: SetTransformedRecordParams) => Promise<void>;
  setAborted: (params: {id: string}) => Promise<void>;
  updateState: (params: UpdateStateParams) => Promise<void>;
};
/* eslint-enable no-unused-vars,@typescript-eslint/no-explicit-any */

export async function createApiClient(options: ApiClientOptions, keycloakOptions: KeycloakOptions): Promise<ApiClient> {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:api-client');
  if (!keycloakOptions) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Keycloak options missing on record import api client creation');
  }
  const {recordImportApiUrl, cfHeader, userAgent = 'Record import API client / Javascript', allowSelfSignedApiCert} = options;
  const serviceTokenOperator: ServiceTokenOperator = await createServiceAuthoperator(keycloakOptions);
  return {
    getBlobs,
    createBlob,
    getBlobMetadata,
    deleteBlob,
    deleteProfile,
    deleteBlobContent,
    getBlobContent,
    getProfile,
    createOrModifyProfile,
    queryProfiles,
    setCataloger,
    setNotificationEmail,
    setTransformationFailed,
    setCorrelationId,
    setRecordProcessed,
    setTransformedRecord,
    setAborted, updateState
  };

  // MARK: createBLob
  async function createBlob({blob, type, profile, duplex}: CreateBlobParams) {
    debug('createBlob');
    const headers = {
      'content-type': type,
      'Import-Profile': profile,
      'cf-connecting-ip': cfHeader
    };

    Object.keys(headers).forEach(header => {
      if (headers[header] === undefined) {
        delete headers[header];
      }
    });

    const response = await doRequest(`${recordImportApiUrl}/blobs`, {
      method: 'POST',
      body: blob,
      headers,
      duplex
    });

    if (response.status === httpStatus.CREATED) {
      return parseBlobId(response);
    }

    const errorMessage = await response?.text() ?? httpStatus[`${response.status}_MESSAGE`];
    throw new ApiError(response.status, errorMessage);

    function parseBlobId(response): string {
      const location = response.headers.get('location');
      if (!location) {
        throw new ApiError(response.status, 'Missing location header');
      }
      const [match] = (/\/(?<def>.[^/]*)$/u).exec(location) ?? [];
      return match ?? '';
    }
  }

  // MARK: getBlobMetadata
  async function getBlobMetadata({id}) {
    debug('getBlobMetadata');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}`, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.status === httpStatus.OK) {
      return response.json();
    }

    const errorMessage = await response?.text() ?? httpStatus[`${response.status}_MESSAGE`];
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: getBlobContent
  async function getBlobContent({id}) {
    debug('getBlobContent');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}/content`, {
      headers: {}
    });

    if (response.status === httpStatus.OK && response.body) {
      return {
        contentType: response.headers.get('content-type') ?? '',
        readStream: Readable.fromWeb(response.body)
      };
    }

    const errorMessage = await response?.text() ?? httpStatus[`${response.status}_MESSAGE`];
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: getProfile
  async function getProfile({id}) {
    debug('getProfile');
    const response = await doRequest(`${recordImportApiUrl}/profiles/${id}`, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.status === httpStatus.OK) {
      return response.json();
    }

    const errorMessage = await response?.text() ?? httpStatus[`${response.status}_MESSAGE`];
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: deleteProfile
  async function deleteProfile({id}): Promise<void> {
    debug('deleteProfile');
    const response = await doRequest(`${recordImportApiUrl}/profiles/${id}`, {
      method: 'DELETE',
      headers: {}
    });

    if (response.status !== httpStatus.NO_CONTENT) {
      const errorMessage = await response?.text() ?? httpStatus[`${response.status}_MESSAGE`];
      throw new ApiError(response.status, errorMessage);
    }
  }

  // MARK: queryProfiles
  async function queryProfiles() {
    debug('queryProfiles');
    const response = await doRequest(`${recordImportApiUrl}/profiles`, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.status === httpStatus.OK) {
      return response.json();
    }

    const errorMessage = await response?.text() ?? httpStatus[`${response.status}_MESSAGE`];
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: modifyProfile
  async function createOrModifyProfile({id, payload}: CreateOrModifyProfileParams): Promise<void> {
    debug('modifyProfile');
    const response = await doRequest(`${recordImportApiUrl}/profiles/${id}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (![httpStatus.CREATED, httpStatus.NO_CONTENT].includes(response.status)) {
      const errorMessage = await response?.text() ?? httpStatus[`${response.status}_MESSAGE`];
      throw new ApiError(response.status, errorMessage);
    }
  }

  // MARK: deleteBlob
  async function deleteBlob({id}) {
    debug('deleteBlob');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}`, {
      method: 'DELETE',
      headers: {}
    });

    if (response.status === httpStatus.NO_CONTENT) {
      return response.body;
    }

    const errorMessage = await response?.text() ?? httpStatus[`${response.status}_MESSAGE`];
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: deleteBlobContent
  async function deleteBlobContent({id}) {
    debug('deleteBlobContent');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}/content`, {
      method: 'DELETE',
      headers: {}
    });

    if (response.status === httpStatus.NO_CONTENT) {
      return response.body;
    }

    const errorMessage = await response?.text() ?? httpStatus[`${response.status}_MESSAGE`];
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: transformedRecord
  async function setTransformedRecord({id, error}: SetTransformedRecordParams): Promise<void> {
    debug('transformedRecord');
    const conf = {
      id,
      payload: {
        op: BLOB_UPDATE_OPERATIONS.transformedRecord,
        error
      }
    };

    await updateBlobMetadata(conf);
  }

  // MARK: setAborted
  async function setAborted({id}): Promise<void> {
    debug('blob setAborted');
    const conf = {
      id,
      payload: {
        op: BLOB_UPDATE_OPERATIONS.abort
      }
    };

    await updateBlobMetadata(conf);
  }

  // MARK: setTransformationFailed
  async function setTransformationFailed({id, error}: SetTransformationFailedParams): Promise<void> {
    debug('setTransformationFailed');
    await updateBlobMetadata({
      id,
      payload: {
        op: BLOB_UPDATE_OPERATIONS.transformationFailed,
        error
      }
    });
  }

  // MARK: setRecordProcessed
  async function setRecordProcessed({id, status, metadata}: SetRecordProcessedParams): Promise<void> {
    debug('setRecordProcessed');
    const conf = {
      id,
      payload: {
        status, metadata,
        op: BLOB_UPDATE_OPERATIONS.recordProcessed
      }
    };

    await updateBlobMetadata(conf);
  }

  // MARK: setNotificationEmail
  async function setNotificationEmail({id, notificationEmail}: SetNotificationEmailParams): Promise<void> {
    debug('setNotificationEmail');
    const conf = {
      id,
      payload: {
        notificationEmail,
        op: BLOB_UPDATE_OPERATIONS.setNotificationEmail
      }
    };

    await updateBlobMetadata(conf);
  }

  // MARK: setCataloger
  async function setCataloger({id, cataloger}: SetCatalogerParams): Promise<void> {
    debug('setCataloger');
    const conf = {
      id,
      payload: {
        cataloger,
        op: BLOB_UPDATE_OPERATIONS.setCataloger
      }
    };

    await updateBlobMetadata(conf);
  }

  // MARK: setCorrelationId
  async function setCorrelationId({id, correlationId}: SetCorrelationIdParams): Promise<void> {
    debug('setCorrelationId');
    const conf = {
      id,
      payload: {
        correlationId,
        op: BLOB_UPDATE_OPERATIONS.addCorrelationId
      }
    };

    await updateBlobMetadata(conf);
  }

  // MARK: updateState
  async function updateState({id, state}: UpdateStateParams) {
    debug('updateState');
    await updateBlobMetadata({
      id,
      payload: {
        op: BLOB_UPDATE_OPERATIONS.updateState,
        state
      }
    });
  }

  // MARK: getBlobs
  interface query {
    id?: string,
    correlationId?: string,
    profile?: string,
    cataloger?: string,
    notificationEmail?: string,
    contentType?: string,
    state?: keyof typeof BLOB_STATE,
    creationTime?: string,
    modificationTime?: string,
    getAll?: boolean,
    offset?: string,
    limit?: string
  }

  function getBlobs(query: query = {getAll: true}) {
    debug('getBlobs');
    const blobsUrl = createURL(query);
    debug(`Blob url: ${blobsUrl}`);
    const emitter = new EventEmitter();

    pump(query.getAll);

    return emitter;

    function createURL(query) {
      const blobsUrl = new URL(`${recordImportApiUrl}/blobs`);

      Object.keys(query).forEach(k => {
        if (Array.isArray(query[k])) {
          query[k].forEach(value => {
            blobsUrl.searchParams.append(`${k}[]`, value);
          });
          return;
        }

        blobsUrl.searchParams.set(k, query[k]);
      });

      return blobsUrl;
    }

    async function pump(getAll = true, offset?: string) {
      try {
        const response = await doRequest(blobsUrl, getOptions(offset));
        debug(`getBlobs response status: ${response.status}`);
        const nextOffset = response.headers.has('NextOffset') ? response.headers.get('NextOffset') : false;

        if (response.status === httpStatus.OK) {
          const blobs = await response.json();
          emitter.emit('blobs', blobs);

          if (getAll && nextOffset) {
            pump(getAll, nextOffset);
            return;
          }

          emitter.emit('end', nextOffset);
          return;
        }

        emitter.emit('error', new ApiError(response.status, ''));
      } catch (error) {
        emitter.emit('error', error);
      }

      function getOptions(offset?: string) {
        if (offset) {
          return {
            headers: {
              'Accept': 'application/json',
              'QueryOffset': offset
            }
          };
        }

        return {
          headers: {
            'Accept': 'application/json'
          }
        };
      }
    }
  }

  // MARK: updateBlobMetadata
  async function updateBlobMetadata({id, payload}) {
    debug(`updateBlobMetadata: ${payload.op}`);
    try {
      const response = await doRequest(`${recordImportApiUrl}/blobs/${id}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.status === httpStatus.UNPROCESSABLE_ENTITY) {
        debug(`Update blob got: ${response.status}`);
        throw new ApiError(response.status, '');
      }

      if (response.status !== httpStatus.NO_CONTENT) {
        debug(`Update blob got unexpected response status: ${response.status}`);
        throw new ApiError(response.status, '');
      }
    } catch (error) {
      console.log(error); // eslint-disable-line
    }
  }

  // Requests a new token once
  // MARK: doRequest
  async function doRequest(reqUrl, reqOptions) {
    debug('doRequest');
    debug(`Request url: ${reqUrl}`);

    try {
      const options = {headers: {}, ...reqOptions};
      options.headers['User-Agent'] = userAgent;
      options.headers.Authorization = await serviceTokenOperator.getServiceAuthToken();
      options.agent = `${reqUrl}`.indexOf('https') >= 0 ? new https.Agent({rejectUnauthorized: !allowSelfSignedApiCert}) : undefined;

      const response = await fetch(reqUrl, options);
      debug(`doRequest response status: ${response.status}`);

      return response;
    } catch (error) {
      debug(error);
      throw error;
    }
  }
}
