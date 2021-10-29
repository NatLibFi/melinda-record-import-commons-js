/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* Shared modules for microservices of Melinda record batch import system
*
* Copyright (C) 2018 University Of Helsinki (The National Library Of Finland)
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
import {createLogger} from '@natlibfi/melinda-backend-commons';
import {generateAuthorizationHeader} from '@natlibfi/melinda-commons';
import {BLOB_UPDATE_OPERATIONS} from './constants';
import {ApiError} from './error';

export function createApiClient({url, username, password, userAgent = 'Record import API client / Javascript'}) {
  let authHeader; // eslint-disable-line functional/no-let
  const logger = createLogger();

  return {
    getBlobs, createBlob, getBlobMetadata, deleteBlob,
    getBlobContent, deleteBlobContent,
    getProfile, modifyProfile, queryProfiles, deleteProfile,
    setTransformationFailed, setRecordProcessed,
    transformedRecord, setAborted, updateState
  };

  async function createBlob({blob, type, profile}) {
    const response = await doRequest(`${url}/blobs`, {
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
    const response = await doRequest(`${url}/blobs/${id}`, {
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
    const response = await doRequest(`${url}/blobs/${id}/content`, {
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
    const response = await doRequest(`${url}/profiles/${id}`, {
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
    const response = await doRequest(`${url}/profiles/${id}`, {
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
    const response = await doRequest(`${url}/profiles`, {
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
    const response = await doRequest(`${url}/profiles/${id}`, {
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
    const response = await doRequest(`${url}/blobs/${id}`, {
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
    const response = await doRequest(`${url}/blobs/${id}/content`, {
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
    await updateBlobMetadata({
      id,
      payload: {
        op: BLOB_UPDATE_OPERATIONS.transformedRecord,
        error
      }
    });
  }

  async function setAborted({id}) {
    await updateBlobMetadata({
      id,
      payload: {
        op: BLOB_UPDATE_OPERATIONS.abort
      }
    });
  }

  async function setTransformationFailed({id, error}) {
    await updateBlobMetadata({
      id,
      payload: {
        op: BLOB_UPDATE_OPERATIONS.transformationFailed,
        error
      }
    });
  }

  async function setRecordProcessed({blobId, status, metadata}) {
    await updateBlobMetadata({
      id: blobId,
      payload: {
        status, metadata,
        op: BLOB_UPDATE_OPERATIONS.recordProcessed
      }
    });
  }

  async function updateState({id, state}) {
    await updateBlobMetadata({
      id,
      payload: {
        op: BLOB_UPDATE_OPERATIONS.updateState,
        state
      }
    });
  }

  function getBlobs(query = {}) {
    const blobsUrl = createURL();
    const emitter = new EventEmitter();

    pump();

    return emitter;

    function createURL() {
      const blobsUrl = new URL(`${url}/blobs`);

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
    logger.debug(`updateBlobMetadata: ${payload.op}`);
    const response = await doRequest(`${url}/blobs/${id}`, {
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
    const options = {headers: {}, ...reqOptions};

    if (authHeader) {
      options.headers.Authorization = authHeader; // eslint-disable-line functional/immutable-data

      const response = await fetch(reqUrl, options);

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
      const encodedCreds = generateAuthorizationHeader(username, password);
      const response = await fetch(`${url}/auth`, {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          Authorization: encodedCreds
        }
      });

      if (response.status === HttpStatus.NO_CONTENT) {
        return response.headers.get('Token');
      }

      throw new ApiError(response.status);
    }
  }
}
