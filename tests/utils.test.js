import assert from 'node:assert';
import {READERS} from '@natlibfi/fixura';
import generateTests from '@natlibfi/fixugen';
import {isOfflinePeriod, getNextBlob} from '../src/utils.js';
import mongoFixturesFactory from '@natlibfi/fixura-mongo';
import {createMongoBlobsOperator} from '../src/mongoBlobs.js';

let mongoFixtures; // eslint-disable-line functional/no-let

generateTests({
  callback,
  path: [import.meta.dirname, '..', 'test-fixtures', 'utils'],
  recurse: false,
  useMetadataFile: true,
  fixura: {
    reader: READERS.JSON,
    failWhenNotFound: true
  },
  hooks: {
    before: async () => {
      await initMongofixtures();
    },
    beforeEach: async () => {
      await mongoFixtures.clear();
    },
    afterEach: async () => {
      await mongoFixtures.clear();
    },
    after: async () => {
      await mongoFixtures.close();
    }
  }
});

async function initMongofixtures() {
  mongoFixtures = await mongoFixturesFactory({
    rootPath: [import.meta.dirname, '..', 'test-fixtures', 'utils'],
    useObjectId: true
  });
}

async function callback({
  getFixture,
  method = '',
  importOfflinePeriod,
  nowTime,
  profileIds = false,
  state = '',
  expectedResult,
  expectedToFail = false,
  expectedErrorStatus = 200,
  expectedErrorMessage = ''
}) {
  try {
    if (method === 'isOfflinePeriod') {
      const result = isOfflinePeriod(importOfflinePeriod, nowTime);
      return assert.equal(result, expectedResult);
    }

    if (method === 'getNextBlob') {
      const mongoUri = await mongoFixtures.getUri();
      await mongoFixtures.populate(getFixture('dbContents.json'));
      const mongoOperator = await createMongoBlobsOperator(mongoUri, '');
      const result = await getNextBlob(mongoOperator, {profileIds, state, importOfflinePeriod}, nowTime);
      return assert.deepEqual(result, expectedResult);
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
