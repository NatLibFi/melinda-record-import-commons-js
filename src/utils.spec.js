import {expect} from 'chai';
import {READERS} from '@natlibfi/fixura';
import generateTests from '@natlibfi/fixugen';
import {isOfflinePeriod, getNextBlob} from './utils.js';
import mongoFixturesFactory from '@natlibfi/fixura-mongo';
import {createMongoBlobsOperator} from './mongoBlobs.js';

let mongoFixtures; // eslint-disable-line functional/no-let

generateTests({
  callback,
  path: [__dirname, '..', 'test-fixtures', 'utils'],
  recurse: false,
  useMetadataFile: true,
  fixura: {
    reader: READERS.JSON,
    failWhenNotFound: true
  },
  mocha: {
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
    rootPath: [__dirname, '..', 'test-fixtures', 'utils'],
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
      return expect(result).to.eql(expectedResult);
    }

    if (method === 'getNextBlob') {
      const mongoUri = await mongoFixtures.getUri();
      await mongoFixtures.populate(getFixture('dbContents.json'));
      const mongoOperator = await createMongoBlobsOperator(mongoUri, {db: '', collection: 'blobmetadatas'});
      const result = await getNextBlob(mongoOperator, {profileIds, state, importOfflinePeriod}, nowTime);
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
