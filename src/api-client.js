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
import {generateHttpAuthorizationHeader} from './common';

export class ApiClientError extends Error {
	constructor(status, ...params) {
		super(status, ...params);
		this.status = status;
	}
}

export function createApiClient({url, username, password}) {
	const authHeader = generateHttpAuthorizationHeader(username, password);

	return {createBlob, updateBlobMetadata, getBlobMetadata, getBlobContent, getProfile};

	async function createBlob({blob, type, profile}) {
		const response = await fetch(`${url}/blobs`, {
			body: blob,
			headers: {
				Authorization: authHeader,
				method: 'POST',
				'Content-Type': type,
				'Import-Profile': profile
			}
		});

		if (response.status !== HttpStatus.CREATED) {
			throw new ApiClientError(response.status);
		}

		return parseBlobId();

		function parseBlobId() {
			return /\/([0-9]+)$/.exec(response.headers.Location)[1];
		}
	}

	async function getBlobMetadata(id) {
		const response = await fetch(`${url}/blobs/${id}`, {
			headers: {
				Authorization: authHeader,
				Accept: 'application/json'
			}
		});

		if (response.status === HttpStatus.OK) {
			return response.json();
		}

		throw new ApiClientError(response.status);
	}

	async function getBlobContent(id) {
		const response = await fetch(`${url}/blobs/${id}/content`, {
			headers: {
				Authorization: authHeader
			}
		});

		if (response.status === HttpStatus.OK) {
			return response.body;
		}

		throw new ApiClientError(response.status);
	}

	async function getProfile(id) {
		const response = await fetch(`${url}/profiles/${id}`, {
			headers: {
				Authorization: authHeader,
				Accept: 'application/json'
			}
		});

		if (response.status === HttpStatus.OK) {
			return response.json();
		}

		throw new ApiClientError(response.status);
	}

	async function updateBlobMetadata({id, op, numberOfRecords, failedRecords, error}) {
		const body = JSON.stringify(error ? {op, error} : {op, numberOfRecords, failedRecords});
		console.log(body);
		const response = await fetch(`${url}/blobs/${id}`, {
			body,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: authHeader
			}
		});

		if (response.status !== HttpStatus.NO_CONTENT) {
			throw new ApiClientError(response.status);
		}
	}
}
