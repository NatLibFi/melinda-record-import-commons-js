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

import fetch from 'node-fetch';
import HttpStatus from 'http-status';
import {URL} from 'url';
import {Utils} from '@natlibfi/melinda-commons';
import {BLOB_UPDATE_OPERATIONS} from './constants';

const {generateAuthorizationHeader} = Utils;

export class ApiClientError extends Error {
	constructor(status, ...params) {
		super(status, ...params);
		this.status = status;
	}
}

export function createApiClient({url, username, password, userAgent = 'Record import API client / Javascript'}) {
	const authHeader = generateAuthorizationHeader(username, password);

	return {
		getBlobs, createBlob, getBlobMetadata, getBlobContent, getProfile, deleteBlob, deleteBlobContent,
		setTransformationDone, setTransformationFailed, setRecordProcessed, setTransformationStarted
	};

	async function createBlob({blob, type, profile}) {
		const response = await fetch(`${url}/blobs`, {
			method: 'POST',
			body: blob,
			headers: {
				'User-Agent': userAgent,
				Authorization: authHeader,
				'Content-Type': type,
				'Import-Profile': profile
			}
		});

		if (response.status !== HttpStatus.CREATED) {
			throw new ApiClientError(response.status);
		}

		return parseBlobId();

		function parseBlobId() {
			return /\/(.[^/]*)$/.exec(response.headers.get('location'))[1];
		}
	}

	async function getBlobMetadata({id}) {
		const response = await fetch(`${url}/blobs/${id}`, {
			headers: {
				'User-Agent': userAgent,
				Authorization: authHeader,
				Accept: 'application/json'
			}
		});

		if (response.status === HttpStatus.OK) {
			return response.json();
		}

		throw new ApiClientError(response.status);
	}

	async function getBlobContent({id}) {
		const response = await fetch(`${url}/blobs/${id}/content`, {
			headers: {
				'User-Agent': userAgent,
				Authorization: authHeader
			}
		});

		if (response.status === HttpStatus.OK) {
			return response.body;
		}

		throw new ApiClientError(response.status);
	}

	async function getProfile({id}) {
		const response = await fetch(`${url}/profiles/${id}`, {
			headers: {
				'User-Agent': userAgent,
				Authorization: authHeader,
				Accept: 'application/json'
			}
		});

		if (response.status === HttpStatus.OK) {
			return response.json();
		}

		throw new ApiClientError(response.status);
	}

	async function deleteBlob({id}) {
		const response = await fetch(`${url}/blobs/${id}`, {
			method: 'DELETE',
			headers: {
				'User-Agent': userAgent,
				Authorization: authHeader
			}
		});

		if (response.status === HttpStatus.NO_CONTENT) {
			return response.body;
		}

		throw new ApiClientError(response.status);
	}

	async function deleteBlobContent({id}) {
		const response = await fetch(`${url}/blobs/${id}/content`, {
			method: 'DELETE',
			headers: {
				'User-Agent': userAgent,
				Authorization: authHeader
			}
		});

		if (response.status === HttpStatus.NO_CONTENT) {
			return response.body;
		}

		throw new ApiClientError(response.status);
	}

	async function setTransformationDone({id, numberOfRecords, failedRecords}) {
		await updateBlobMetadata({
			id,
			payload: {
				op: BLOB_UPDATE_OPERATIONS.transformationDone,
				numberOfRecords, failedRecords
			}
		});
	}

	async function setTransformationFailed({id, error}) {
		await updateBlobMetadata({
			id,
			payload: {
				error,
				op: BLOB_UPDATE_OPERATIONS.transformationFailed
			}
		});
	}

	async function setRecordProcessed({blobId, status, recordId, metadata}) {
		await updateBlobMetadata({
			id: blobId,
			payload: {
				op: BLOB_UPDATE_OPERATIONS.recordProcessed,
				content: {
					id: recordId,
					status, metadata
				}
			}
		});
	}

	async function setTransformationStarted({id}) {
		await updateBlobMetadata({
			id,
			payload: {
				op: BLOB_UPDATE_OPERATIONS.transformationStarted
			}
		});
	}

	async function getBlobs(query) {
		const blobsUrl = new URL(`${url}/blobs`);

		Object.keys(query).forEach(k => {
			if (Array.isArray(query[k])) {
				query[k].forEach(value => {
					blobsUrl.searchParams.append(`${k}[]`, value);
				});
			} else {
				blobsUrl.searchParams.set(k, query[k]);
			}
		});

		const response = await fetch(blobsUrl, {
			headers: {
				'User-Agent': userAgent,
				Authorization: authHeader,
				Accept: 'application/json'
			}
		});

		if (response.status === HttpStatus.OK) {
			const blobs = await response.json();
			return blobs.map(b => b.id);
		}

		throw new ApiClientError(response.status);
	}

	async function updateBlobMetadata({id, payload}) {
		const response = await fetch(`${url}/blobs/${id}`, {
			method: 'POST',
			body: JSON.stringify(payload),
			headers: {
				'User-Agent': userAgent,
				'Content-Type': 'application/json',
				Authorization: authHeader
			}
		});

		if (response.status !== HttpStatus.NO_CONTENT) {
			throw new ApiClientError(response.status);
		}
	}
}
