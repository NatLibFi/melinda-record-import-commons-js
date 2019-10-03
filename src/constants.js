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

export const BLOB_STATE = {
	PENDING_TRANSFORMATION: 'PENDING_TRANSFORMATION',
	TRANSFORMATION_IN_PROGRESS: 'TRANSFORMATION_IN_PROGRESS',
	TRANSFORMATION_FAILED: 'TRANSFORMATION_FAILED',
	TRANSFORMED: 'TRANSFORMED',
	PROCESSED: 'PROCESSED',
	ABORTED: 'ABORTED'
};

export const BLOB_UPDATE_OPERATIONS = {
	abort: 'abort',
	transformedRecord: 'transformedRecord',
	transformationStarted: 'transformationStarted',
	transformationDone: 'transformationDone',
	transformationFailed: 'transformationFailed',
	recordProcessed: 'recordProcessed',
	updateState: 'updateState'
};

export const RECORD_IMPORT_STATE = {
	CREATED: 'CREATED',
	UPDATED: 'UPDATED',
	INVALID: 'INVALID',
	DUPLICATE: 'DUPLICATE',
	ERROR: 'ERROR',
	SKIPPED: 'SKIPPED'
};
