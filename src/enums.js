/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* Shared modules for microservices of Melinda record batch import system
*
* Copyright (C) 2018-2019 University Of Helsinki (The National Library Of Finland)
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
	notObject: 'entity.not.object',
	unauthorized: 'request.authentication.unauthorized',
	forbiden: 'request.authentication.forbiden',
	badRequest: 'request.bad',
	missingProfile: 'request.profile.missing',
	missingContent: 'request.content.missing',
	missingContentType: 'request.contenttype.missing',
	bodyTooLarge: 'request.body.large',
	validation: 'request.content.validation',
	idConflict: 'request.mismatch.id',
	unknown: 'unknown'
};

exports.jobs = {
	pollBlobs: 'poll.GET./blobs/',
	pollBlobsPending: 'poll.GET./blobs/.pending',
	pollBlobsTransformed: 'poll.GET./blobs/.transformed',
	pollBlobsAborted: 'poll.GET./blobs/.aborted'
};

exports.httpCodes = {
	OK: 200,
	Created: 201,
	Accepted: 202,
	NoContent: 204,
	Updated: 204,
	Malformed: 400,
	BadRequest: 400,
	Unauthorized: 401,
	Forbidden: 403,
	NotFound: 404,
	MethodNotAllowed: 405,
	Conflict: 409,
	PayloadTooLarge: 413,
	Unsupported: 415,
	Teapot: 418,
	ValidationError: 422,
	InternalServerError: 500,
	NotImplemented: 501,
	BadGateway: 502,
	ServiceUnavailable: 503
};
