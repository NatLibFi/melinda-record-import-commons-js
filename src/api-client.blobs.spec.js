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
};/**/

generateTests({
  callback,
  path: [__dirname, '..', 'test-fixtures', 'api-client', 'blobs'],
  useMetadataFile: true,
  recurse: false,
  fixura: {
    reader: READERS.JSON,
    failWhenNotFound: false
  }
});

// Blob handling
async function callback({getFixture, method, expectedError = false, expectedErrorStatus = '000'}) {
  const client = createApiClient(config);
  const input = getFixture('input.json');
  const output = getFixture('output.json');

  try {
    if (method === 'getBlobs') {
      const {query} = input;
      const {expectedResult} = output;
      const emitter = client.getBlobs(query);
      const blobsArray = [];
      const emitterResult = new Promise((resolve, reject) => {
        emitter
          .on('error', reject)
          .on('end', resolve)
          .on('blobs', blobs => {
            // Use console.log coz logger starts print with date and type
            // eslint-disable-next-line no-console
            blobsArray.push(blobs); //eslint-disable-line functional/immutable-data
          });
      });
      await emitterResult;
      debug(blobsArray);
      return expect(blobsArray).to.eql(expectedResult);
    }

    if (method === 'createBlob') {

      return;
    }

    if (method === 'getBlobMetadata') {

      return;
    }

    if (method === 'deleteBlob') {

      return;
    }

    if (method === 'getBlobContent') {

      return;
    }

    if (method === 'deleteBlobContent') {

      return;
    }

    if (method === 'setCorrelationId') {

      return;
    }

    if (method === 'setAborted') {
      return;

    }

    if (method === 'updateState') {
      return;
    }

    return;
  } catch (error) {
    if (expectedError) {
      // Error match check here
      debug('Error handling');
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
