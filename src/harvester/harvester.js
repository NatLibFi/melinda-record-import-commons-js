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

/* eslint-disable import/default */

import {registerSignalHandlers} from '../common';
import {createApiClient} from '../api-client';
import {Utils} from '@natlibfi/melinda-commons';

const {createLogger} = Utils;

export default async function (harvestCallback) {
	const {API_URL, API_USERNAME, API_PASSWORD, PROFILE_ID} = await import('./config');
	const Logger = createLogger();
	const ApiClient = createApiClient({url: API_URL, username: API_USERNAME, password: API_PASSWORD});

	registerSignalHandlers();

	try {
		await harvestCallback({recordsCallback: createBlob});
		process.exit();
	} catch (err) {
		Logger.log('error', err.stack);
		process.exit(-1);
	}

	async function createBlob(records) {
		const id = await ApiClient.createBlob({
			blob: JSON.stringify(records),
			type: 'application/json',
			profile: PROFILE_ID
		});

		Logger.info(`Created new blob ${id}`);
	}
}
