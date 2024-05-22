/* eslint-disable no-unused-vars */

import {expect} from 'chai';
import {READERS} from '@natlibfi/fixura';
import generateTests from '@natlibfi/fixugen-http-client';
import createDebugLogger from 'debug';
import {createApiClient} from './api-client';
import {Error as ApiError} from '@natlibfi/melinda-commons';

const debug = createDebugLogger('@natlibfi/melinda-record-import-commons/api-client:test');
const config = {
  keycloakConfig: {test: true},
  recordImportApiUrl: 'http://foo.bar',
  recordImportApiUsername: 'foo',
  recordImportApiPassword: 'bar',
  userAgent: 'test'
};


generateTests({
  callback,
  path: [__dirname, '..', 'test-fixtures', 'api-client', 'records'],
  useMetadataFile: true,
  recurse: false,
  fixura: {
    reader: READERS.JSON,
    failWhenNotFound: false
  }
});

// Blob handling
/*async*/ function callback({getFixture, method, expectedError = false, expectedErrorStatus = '000'}) {
  const client = createApiClient(config);
  const input = getFixture('input.json');
  const output = getFixture('output.json');

  try {
    if (method === 'setTransformationFailed') {

      return;
    }


    if (method === 'setRecordProcessed') {

      return;
    }

    if (method === 'transformedRecord') {

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
