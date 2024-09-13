import {expect} from 'chai';
import {READERS} from '@natlibfi/fixura';
import mongoFixturesFactory from '@natlibfi/fixura-mongo';
import generateTests from '@natlibfi/fixugen';
import {createMongoBlobsOperator} from './mongoBlobs.js';

let mongoFixtures; // eslint-disable-line functional/no-let

generateTests({
  callback,
  path: [__dirname, '..', 'test-fixtures', 'readBlob'],
  recurse: false,
  useMetadataFile: true,
  fixura: {
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
    rootPath: [__dirname, '..', 'test-fixtures', 'readBlob'],
    gridFS: {bucketName: 'blobs'},
    useObjectId: true
  });
}

async function callback({
  getFixture,
  operationParams,
  expectedToFail = false,
  expectedErrorStatus = 200,
  expectedErrorMessage = ''
}) {
  const mongoUri = await mongoFixtures.getUri();
  await mongoFixtures.populate(getFixture({components: ['dbContents.json'], reader: READERS.JSON}));
  const mongoOperator = await createMongoBlobsOperator(mongoUri, {db: '', collection: 'blobmetadatas'});
  const expectedResult = await getFixture({components: ['expectedResult.json'], reader: READERS.JSON});
  try {
    const result = await mongoOperator.readBlob(operationParams);
    expect(result).to.eql(expectedResult);
  } catch (error) {
    if (!expectedToFail) {
      throw error;
    }

    // console.log(error); // eslint-disable-line
    expect(error.status).to.eql(expectedErrorStatus);
    expect(error.payload).to.eql(expectedErrorMessage);
    expect(expectedToFail).to.eql(true, 'This test is not suppose to fail!');
  }
}
