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

import {EventEmitter} from 'events';
import fetch from 'node-fetch';
import HttpStatus from 'http-status';
import {URL} from 'url';
import {generateAuthorizationHeader, Error as ApiError} from '@natlibfi/melinda-commons';
import {BLOB_UPDATE_OPERATIONS} from './constants';
import createDebugLogger from 'debug';

export function createApiClient({recordImportApiUrl, recordImportApiUsername, recordImportApiPassword, userAgent = 'Record import API client / Javascript'}) {
  let authHeader; // eslint-disable-line functional/no-let
  const debug = createDebugLogger('@natlibfi/melinda-import-commons:api-client');

  return {
    getBlobs, createBlob, getBlobMetadata, deleteBlob,
    getBlobContent, deleteBlobContent,
    getProfile, modifyProfile, queryProfiles, deleteProfile,
    setTransformationFailed, setCorrelationId, setRecordProcessed,
    setRecordQueued, transformedRecord, setAborted, updateState
  };

  async function createBlob({blob, type, profile}) {
    debug('createBlob');
    const response = await doRequest(`${recordImportApiUrl}/blobs`, {
      method: 'POST',
      body: blob,
      headers: {
        'User-Agent': userAgent,
        'Content-Type': type,
        'Import-Profile': profile
      }
    });

    if (response.status === HttpStatus.CREATED) {
      return parseBlobId();
    }

    throw new ApiError(response.status);

    function parseBlobId() {
      return (/\/(?<def>.[^/]*)$/u).exec(response.headers.get('location'))[1];
    }
  }

  async function getBlobMetadata({id}) {
    debug('getBlobMetadata');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}`, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json'
      }
    });

    if (response.status === HttpStatus.OK) {
      return response.json();
    }

    throw new ApiError(response.status);
  }

  async function getBlobContent({id}) {
    debug('getBlobContent');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}/content`, {
      headers: {
        'User-Agent': userAgent
      }
    });

    if (response.status === HttpStatus.OK) {
      return {
        contentType: response.headers.get('Content-Type'),
        readStream: response.body
      };
    }

    throw new ApiError(response.status);
  }

  async function getProfile({id}) {
    debug('getProfile');
    const response = await doRequest(`${recordImportApiUrl}/profiles/${id}`, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json'
      }
    });

    if (response.status === HttpStatus.OK) {
      return response.json();
    }

    throw new ApiError(response.status);
  }

  async function deleteProfile({id}) {
    debug('deleteProfile');
    const response = await doRequest(`${recordImportApiUrl}/profiles/${id}`, {
      method: 'DELETE',
      headers: {
        'User-Agent': userAgent
      }
    });

    if (response.status !== HttpStatus.NO_CONTENT) { // eslint-disable-line functional/no-conditional-statement
      throw new ApiError(response.status);
    }
  }

  async function queryProfiles() {
    debug('queryProfiles');
    const response = await doRequest(`${recordImportApiUrl}/profiles`, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json'
      }
    });

    if (response.status === HttpStatus.OK) {
      return response.json();
    }

    throw new ApiError(response.status);
  }

  async function modifyProfile({id, payload}) {
    debug('modifyProfile');
    const response = await doRequest(`${recordImportApiUrl}/profiles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: {
        'User-Agent': userAgent,
        'Content-Type': 'application/json'
      }
    });

    if (![HttpStatus.CREATED, HttpStatus.NO_CONTENT].includes(response.status)) { // eslint-disable-line functional/no-conditional-statement
      throw new ApiError(response.status);
    }
  }

  async function deleteBlob({id}) {
    debug('deleteBlob');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}`, {
      method: 'DELETE',
      headers: {
        'User-Agent': userAgent
      }
    });

    if (response.status === HttpStatus.NO_CONTENT) {
      return response.body;
    }

    throw new ApiError(response.status);
  }

  async function deleteBlobContent({id}) {
    debug('deleteBlobContent');
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}/content`, {
      method: 'DELETE',
      headers: {
        'User-Agent': userAgent
      }
    });

    if (response.status === HttpStatus.NO_CONTENT) {
      return response.body;
    }

    throw new ApiError(response.status);
  }

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

  async function setAborted({id}) {
    debug('setAborted');
    await updateBlobMetadata({
      id,
      payload: {
        op: BLOB_UPDATE_OPERATIONS.abort
      }
    });
  }

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

  async function setRecordQueued({id, title, standardIdentifiers}) {
    debug('setRecordQueued');
    debug(`${title}`);
    debug(`${standardIdentifiers}`);
    await updateBlobMetadata({
      id,
      payload: {
        title, standardIdentifiers,
        op: BLOB_UPDATE_OPERATIONS.recordQueued
      }
    });
  }

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

    async function pump(offset) {
      const response = await doRequest(blobsUrl, getOptions());
      debug(`getBlobs response status: ${response.status}`);

      if (response.status === HttpStatus.OK) {
        emitter.emit('blobs', await response.json());

        if (response.headers.has('NextOffset')) {
          pump(response.headers.get('NextOffset'));
          return;
        }

        emitter.emit('end');
        return;
      }

      emitter.emit('error', new ApiError(response.status));

      function getOptions() {
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

  async function updateBlobMetadata({id, payload}) {
    debug(`updateBlobMetadata: ${payload.op}`);
    const response = await doRequest(`${recordImportApiUrl}/blobs/${id}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'User-Agent': userAgent,
        'Content-Type': 'application/json'
      }
    });

    if (response.status !== HttpStatus.NO_CONTENT) { // eslint-disable-line functional/no-conditional-statement
      throw new ApiError(response.status);
    }
  }

  // Requests a new token once
  async function doRequest(reqUrl, reqOptions) {
    debug('doRequest');
    const options = {headers: {}, ...reqOptions};

    if (authHeader) {
      options.headers.Authorization = authHeader; // eslint-disable-line functional/immutable-data

      const response = await fetch(reqUrl, options);
      debug(`doRequest response status: ${response.status}`);

      if (response.status === HttpStatus.UNAUTHORIZED) {
        const token = await getAuthToken();
        authHeader = `Bearer ${token}`; // eslint-disable-line require-atomic-updates
        options.headers.Authorization = authHeader; // eslint-disable-line functional/immutable-data

        return fetch(reqUrl, options);
      }

      return response;
    }

    const token = await getAuthToken();
    authHeader = `Bearer ${token}`; // eslint-disable-line require-atomic-updates
    options.headers.Authorization = authHeader; // eslint-disable-line functional/immutable-data

    return fetch(reqUrl, options);

    async function getAuthToken() {
      debug('getAuthToken');
      const encodedCreds = generateAuthorizationHeader(recordImportApiUsername, recordImportApiPassword);
      const response = await fetch(`${recordImportApiUrl}/auth`, {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          Authorization: encodedCreds
        }
      });
      debug(`getAuthToken response status: ${response.status}`);

      if (response.status === HttpStatus.NO_CONTENT) {
        const token = response.headers.get('Token');
        if (token === '0-0-0') {
          debug('Got dev token 0-0-0');
          return token;
        }

        return token;
      }

      throw new ApiError(response.status);
    }
  }
}
