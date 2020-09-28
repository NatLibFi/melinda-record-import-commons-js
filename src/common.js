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

import http from 'http';

export function registerSignalHandlers({stopHealthCheckService = () => {}} = {}) { // eslint-disable-line no-empty-function
  process.on('SIGINT', () => {
    stopHealthCheckService();
    process.exit(1); // eslint-disable-line no-process-exit
  });
}

export function startHealthCheckService(port) {
  const server = http.createServer((req, res) => {
    res.statusCode = req.url === '/healthz' ? 200 : 404; // eslint-disable-line functional/immutable-data
    res.end();
  }).listen(port);
  return function () {
    return new Promise(resolve => {
      server.close(resolve);
    });
  };
}

export async function closeResources({connection, channel}) {
  if (channel) {
    await channel.close();
    await closeConnection();
    return;
  }

  await closeConnection();

  function closeConnection() {
    if (connection) {
      return connection.close();
    }
  }
}
