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

import {readEnvironmentVariable} from '@natlibfi/melinda-backend-commons';
import {parseBoolean} from '@natlibfi/melinda-commons';

export const recordImportApiOptions = {
  recordImportApiUrl: readEnvironmentVariable('RECORD_IMPORT_API_URL'),
  recordImportApiUsername: readEnvironmentVariable('RECORD_IMPORT_API_USERNAME'),
  recordImportApiPassword: readEnvironmentVariable('RECORD_IMPORT_API_PASSWORD')
};

export const AMQP_URL = readEnvironmentVariable('AMQP_URL');

export const BLOB_ID = readEnvironmentVariable('BLOB_ID');
export const PROFILE_ID = readEnvironmentVariable('PROFILE_ID');

export const ABORT_ON_INVALID_RECORDS = readEnvironmentVariable('ABORT_ON_INVALID_RECORDS', {defaultValue: false, format: parseBoolean});
export const HEALTH_CHECK_PORT = readEnvironmentVariable('HEALTH_CHECK_PORT', {defaultValue: 8080, format: v => Number(v)});

export const API_CLIENT_USER_AGENT = readEnvironmentVariable('API_CLIENT_USER_AGENT', {defaultValue: '_RECORD-IMPORT-TRANSFORMER'});
