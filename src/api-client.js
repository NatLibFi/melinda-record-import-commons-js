import {EventEmitter} from 'events';
import fetch from 'node-fetch';
import {URL} from 'url';
import {Error as ApiError} from '@natlibfi/melinda-commons';
import {BLOB_UPDATE_OPERATIONS} from './constants.js';
import createDebugLogger from 'debug';
import https from 'https';
import {createServiceAuthoperator} from './oidc.js';
import httpStatus from 'http-status';

export async function createApiClient({recordImportApiUrl, userAgent = 'Record import API client / Javascript', allowSelfSignedApiCert}, keycloakOptions) {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:api-client:dev');
  if (!keycloakOptions) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Keycloak options missing on record import api client creation');
  }

  const serviceTokenOperator = await createServiceAuthoperator(keycloakOptions);
  return {
    getBlobs, createBlob, getBlobMetadata, deleteBlob,
    getBlobContent, deleteBlobContent,
    getProfile, modifyProfile, queryProfiles, deleteProfile,
    setTransformationFailed, setCorrelationId, setRecordProcessed,
    transformedRecord, setAborted, updateState
  };

  // MARK: createBLob
  async function createBlob({blob, type, profile}) {
    debug('createBlob');
    const response = await doRequest(`${recordImportApiUrl}/blobs`, {
      method: 'POST',
      body: blob,
      headers: {
        'User-Agent': userAgent,
        'content-type': type,
        'Import-Profile': profile
      }
    });

    if (response.status === httpStatus.CREATED) {
      return parseBlobId();
    }

    const errorMessage = await response.text();
    throw new ApiError(response.status, errorMessage);

    function parseBlobId() {
      return (/\/(?<def>.[^/]*)$/u).exec(response.headers.get('location'))[1];
    }
  }

  // MARK: getBlobMetadata
  async function getBlobMetadata({id}) {
    debug('getBlobMetadata');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}`, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json'
      }
    });

    if (response.status === httpStatus.OK) {
      return response.json();
    }

    const errorMessage = await response.text();
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: getBlobContent
  async function getBlobContent({id}) {
    debug('getBlobContent');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}/content`, {
      headers: {
        'User-Agent': userAgent
      }
    });

    if (response.status === httpStatus.OK) {
      return {
        contentType: response.headers.get('content-type'),
        readStream: response.body
      };
    }

    const errorMessage = await response.text();
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: getProfile
  async function getProfile({id}) {
    debug('getProfile');
    const response = await doRequest(`${recordImportApiUrl}/profiles/${id}`, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json'
      }
    });

    if (response.status === httpStatus.OK) {
      return response.json();
    }

    const errorMessage = await response.text();
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: deleteProfile
  async function deleteProfile({id}) {
    debug('deleteProfile');
    const response = await doRequest(`${recordImportApiUrl}/profiles/${id}`, {
      method: 'DELETE',
      headers: {
        'User-Agent': userAgent
      }
    });

    if (response.status !== httpStatus.NO_CONTENT) { // eslint-disable-line functional/no-conditional-statements
      const errorMessage = await response.text();
      throw new ApiError(response.status, errorMessage);
    }
  }

  // MARK: queryProfiles
  async function queryProfiles() {
    debug('queryProfiles');
    const response = await doRequest(`${recordImportApiUrl}/profiles`, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json'
      }
    });

    if (response.status === httpStatus.OK) {
      return response.json();
    }

    const errorMessage = await response.text();
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: modifyProfile
  async function modifyProfile({id, payload}) {
    debug('modifyProfile');
    const response = await doRequest(`${recordImportApiUrl}/profiles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: {
        'User-Agent': userAgent,
        'content-type': 'application/json'
      }
    });

    if (![httpStatus.CREATED, httpStatus.NO_CONTENT].includes(response.status)) { // eslint-disable-line functional/no-conditional-statements
      const errorMessage = await response.text();
      throw new ApiError(response.status, errorMessage);
    }
  }

  // MARK: deleteBlob
  async function deleteBlob({id}) {
    debug('deleteBlob');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}`, {
      method: 'DELETE',
      headers: {
        'User-Agent': userAgent
      }
    });

    if (response.status === httpStatus.NO_CONTENT) {
      return response.body;
    }

    const errorMessage = await response.text();
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: deleteBlobContent
  async function deleteBlobContent({id}) {
    debug('deleteBlobContent');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}/content`, {
      method: 'DELETE',
      headers: {
        'User-Agent': userAgent
      }
    });

    if (response.status === httpStatus.NO_CONTENT) {
      return response.body;
    }

    const errorMessage = await response.text();
    throw new ApiError(response.status, errorMessage);
  }

  // MARK: transformedRecord
  async function transformedRecord({id, error = undefined}) {
    debug('transformedRecord');
    await updateBlobMetadata({
      id,
      payload: {
        op: BLOB_UPDATE_OPERATIONS.transformedRecord,
        error
      }
    });
  }

  // MARK: setAborted
  async function setAborted({id}) {
    debug('blob setAborted');
    await updateBlobMetadata({
      id,
      payload: {
        op: BLOB_UPDATE_OPERATIONS.abort
      }
    });
  }

  // MARK: setTransformationFailed
  async function setTransformationFailed({id, error}) {
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
  async function setRecordProcessed({id, status, metadata}) {
    debug('setRecordProcessed');
    await updateBlobMetadata({
      id,
      payload: {
        status, metadata,
        op: BLOB_UPDATE_OPERATIONS.recordProcessed
      }
    });
  }

  // MARK: setCorrelationId
  async function setCorrelationId({id, correlationId}) {
    debug('setCorrelationId');
    await updateBlobMetadata({
      id,
      payload: {
        correlationId,
        op: BLOB_UPDATE_OPERATIONS.addCorrelationId
      }
    });
  }

  // MARK: updateState
  async function updateState({id, state}) {
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
  function getBlobs(query = {}) {
    debug('getBlobs');
    const blobsUrl = createURL();
    debug(`Blob url: ${blobsUrl}`);
    const emitter = new EventEmitter();

    pump();

    return emitter;

    function createURL() {
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

    async function pump(offset = false) {
      try {
        const response = await doRequest(blobsUrl, getOptions(offset));
        debug(`getBlobs response status: ${response.status}`);

        if (response.status === httpStatus.OK) {
          emitter.emit('blobs', await response.json());

          if (response.headers.has('NextOffset')) {
            pump(response.headers.get('NextOffset'));
            return;
          }

          emitter.emit('end');
          return;
        }

        emitter.emit('error', new ApiError(response.status));
      } catch (error) {
        emitter.emit('error', error);
      }

      function getOptions(offset) {
        const options = {
          headers: {
            'User-Agent': userAgent,
            Accept: 'application/json'
          }
        };

        if (offset) {
          options.headers.QueryOffset = offset; // eslint-disable-line functional/immutable-data
          return options;
        }

        return options;
      }
    }
  }

  // MARK: updateBlobMetadata
  async function updateBlobMetadata({id, payload}) {
    debug(`updateBlobMetadata: ${payload.op}`);
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: {
        'User-Agent': userAgent,
        'content-type': 'application/json'
      }
    });

    if (response.status !== httpStatus.NO_CONTENT) { // eslint-disable-line functional/no-conditional-statements
      debug(`Update blob got unexpected response status: ${response.status}`);
      const errorMessage = await response?.text() || 'No error message';
      throw new ApiError(response.status, errorMessage);
    }
  }

  // Requests a new token once
  // MARK: doRequest
  async function doRequest(reqUrl, reqOptions) {
    debug('doRequest');
    debug(`Request url: ${reqUrl}`);

    try {
      const options = {headers: {}, ...reqOptions};
      options.headers.Accept = 'html'; // eslint-disable-line functional/immutable-data
      options.headers.Authorization = await serviceTokenOperator.getServiceAuthToken(); // eslint-disable-line functional/immutable-data
      options.agent = `${reqUrl}`.indexOf('https') >= 0 ? new https.Agent({rejectUnauthorized: !allowSelfSignedApiCert}) : undefined; // eslint-disable-line functional/immutable-data

      const response = await fetch(reqUrl, options);
      debug(`doRequest response status: ${response.status}`);

      if (response.status === httpStatus.UNAUTHORIZED) {
        const errorMessage = await response.text();
        throw new ApiError(response.status, errorMessage);
      }

      return response;
    } catch (error) {
      debug(error);
      return {status: 500, message: 'Error on auth'};
    }
  }
}
