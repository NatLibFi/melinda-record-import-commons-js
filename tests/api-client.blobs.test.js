import assert from 'node:assert';
import {READERS} from '@natlibfi/fixura';
import generateTests from '@natlibfi/fixugen-http-client';
import createDebugLogger from 'debug';
import {createApiClient} from '../src/api-client.js';
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
  path: [import.meta.dirname, '..', 'test-fixtures', 'api-client', 'blobs'],
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
            // console.log(blobs);
            blobsArray.push(blobs); //eslint-disable-line functional/immutable-data
          });
      });
      await emitterResult;
      debug(blobsArray);
      return assert.deepEqual(blobsArray, expectedResult);
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
      assert(error instanceof Error);

      if (error instanceof ApiError) { // specified error
        assert.match(error.payload, new RegExp(expectedError, 'u'));
        assert.match(error.status, new RegExp(expectedErrorStatus, 'u'));
        return;
      }

      // common error
      assert.match(error.message, new RegExp(expectedError, 'u'));
      return;
    }

    throw error;
  }
}
