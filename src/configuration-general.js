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
import {checkEnv as checkEnvShared} from './shared';

const enums = require('./utils/enums');
const httpCodes = require('./utils/http-codes');

export default function checkEnv(MANDATORY_ENV_VARIABLES) {
	checkEnvShared(MANDATORY_ENV_VARIABLES);
}

exports.enums = enums;
exports.httpCodes = httpCodes;

const hostname = process.env.HOSTNAME_API || '127.0.0.1';
exports.hostname = hostname;
const portAPI = process.env.PORT_API || 3000;
exports.portAPI = portAPI;
const portController = process.env.PORT_CNTRL || 3001;
exports.portController = portController;

exports.urlAPI = process.env.URL_API || 'http://' + hostname + ':' + portAPI;

exports.mongodb = {
	uri: process.env.MONGODB_URI || 'mongodb://generalAdmin:ToDoChangeAdmin@127.0.0.1:27017/melinda-record-import-api'
};

exports.agendaMongo = {
	db: {
		address: process.env.MONGODB_URI || 'mongodb://generalAdmin:ToDoChangeAdmin@127.0.0.1:27017/melinda-record-import-api',
		collection: 'jobs'
	}
};

exports.mongoDebug = process.env.MONGODB_DEBUG || false;

exports.logs = process.env.DEBUG || false;

exports.seedDB = process.env.DB_SEED || true;
