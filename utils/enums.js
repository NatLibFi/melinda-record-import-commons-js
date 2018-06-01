/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* API microservice of Melinda record batch import system
*
* Copyright (C) 2018 University Of Helsinki (The National Library Of Finland)
*
* This file is part of melinda-record-import-api
*
* melinda-record-import-api program is free software: you can redistribute it and/or modify
* it under the terms of the GNU Affero General Public License as
* published by the Free Software Foundation, either version 3 of the
* License, or (at your option) any later version.
*
* melinda-record-import-api is distributed in the hope that it will be useful,
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

/* eslint-disable no-unused-vars */

'use strict';
exports.environment = {
	production: 'production',
	development: 'development',
	testing: 'testing'
};

exports.blobStates = {
	pending: 'PENDING_TRANSFORMATION',
	inProgress: 'TRANSFORMATION_IN_PROGRESS',
	failed: 'TRANSFORMATION_FAILED',
	transformed: 'TRANSFORMED',
	processed: 'PROCESSED',
	aborted: 'ABORTED'
};

exports.recodImportStatuses = {
	created: 'CREATED',
	updated: 'UPDATED',
	invalid: 'INVALID',
	duplicate: 'DUPLICATE',
	multiple: 'MULTIPLE_MATCHES',
	error: 'ERROR'
};

exports.errorTypes = {
	parseFailed: 'entity.parse.failed',
	notObject: 'entity.not.object',
	invalidSyntax: 'request.mismatch.id',
	unauthorized: 'request.authentication.unauthorized',
	forbiden: 'request.authentication.forbiden',
	missing: 'request.profile.missing',
	unknown: 'unknown'
};

exports.jobs = {
	pollBlobs: 'poll.GET./blobs/',
	pollBlobsPending: 'poll.GET./blobs/.pending',
	pollBlobsTransformed: 'poll.GET./blobs/.transformed',
	pollBlobsAborted: 'poll.GET./blobs/.aborted'
};
