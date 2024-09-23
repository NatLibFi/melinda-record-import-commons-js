import {expect} from 'chai';
import {READERS} from '@natlibfi/fixura';
import generateTests from '@natlibfi/fixugen';
import {isOfflinePeriod} from './utils.js';

generateTests({
  callback,
  path: [__dirname, '..', 'test-fixtures', 'utils'],
  recurse: false,
  useMetadataFile: true,
  fixura: {
    reader: READERS.JSON,
    failWhenNotFound: true
  }
});

function callback({
  method = '',
  importOfflinePeriod,
  nowTime,
  expectedResult,
  expectedToFail = false,
  expectedErrorStatus = 200,
  expectedErrorMessage = ''
}) {
  try {
    if (method === 'isOfflinePeriod') {
      const result = isOfflinePeriod(importOfflinePeriod, nowTime);
      return expect(result).to.eql(expectedResult);
    }

    if (method === 'getNextBlobId') {
      const result = isOfflinePeriod(importOfflinePeriod, nowTime);
      return expect(result).to.eql(expectedResult);
    }

    throw new Error('Invalid test method!');
  } catch (error) {
    handleError(error);
  }

  function handleError(error) {
    if (!expectedToFail) {
      throw error;
    }

    // console.log(error); // eslint-disable-line
    expect(error.status).to.eql(expectedErrorStatus);
    expect(error.payload).to.eql(expectedErrorMessage);
    expect(expectedToFail).to.eql(true, 'This test is not suppose to fail!');
  }
}
