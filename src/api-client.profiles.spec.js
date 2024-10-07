/* eslint-disable no-unused-vars */

/*
import {expect} from 'chai';
import {READERS} from '@natlibfi/fixura';
import generateTests from '@natlibfi/fixugen-http-client';
import createDebugLogger from 'debug';
import {createApiClient} from './api-client';
import {Error as ApiError} from '@natlibfi/melinda-commons';

const debug = createDebugLogger('@natlibfi/melinda-record-import-commons/api-client:test');
const config = {
  keycloakOptions: {test: true},
  recordImportApiOptions: {
    recordImportApiUrl: 'http://foo.bar',
    userAgent: 'test',
    allowSelfSignedApiCert: true
  }
};
generateTests({
  callback,
  path: [__dirname, 'test-fixtures', 'api-client', 'profiles'],
  useMetadataFile: true,
  recurse: false,
  fixura: {
    reader: READERS.JSON,
    failWhenNotFound: false
  }
});

// Blob handling
async function callback({getFixture, method, expectedError = false, expectedErrorStatus = '000'}) {
  const {recordImportApiOptions, keycloakOptions} = config;
  const client = await createApiClient(recordImportApiOptions, keycloakOptions);
  const input = getFixture('input.json');
  const output = getFixture('output.json');

  try {
    if (method === 'getProfile') {

      return;
    }

    if (method === 'modifyProfile') {

      return;
    }

    if (method === 'queryProfiles') {

      return;
    }

    if (method === 'deleteProfile') {

      return;
    }

    return;
  } catch (error) {
    if (expectedError) {
      // Error match check here
      expect(error).to.be.an('error');

      if (error instanceof ApiError) { // specified error
        expect(error.payload).to.match(new RegExp(expectedError, 'u'));
        expect(error.status).to.match(new RegExp(expectedErrorStatus, 'u'));
        return;
      }

      // common error
      expect(error.message).to.match(new RegExp(expectedError, 'u'));
      return;
    }

    throw error;
  }
}
*/
