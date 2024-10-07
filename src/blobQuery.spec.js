import {expect} from 'chai';
import {READERS} from '@natlibfi/fixura';
import mongoFixturesFactory from '@natlibfi/fixura-mongo';
import generateTests from '@natlibfi/fixugen';
import {createMongoBlobsOperator} from './mongoBlobs.js';

let mongoFixtures; // eslint-disable-line functional/no-let

generateTests({
  callback,
  path: [__dirname, '..', 'test-fixtures', 'blob', 'query'],
  recurse: false,
  useMetadataFile: true,
  fixura: {
    failWhenNotFound: true,
    reader: READERS.JSON
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
    rootPath: [__dirname, '..', 'test-fixtures', 'blob', 'query'],
    gridFS: {bucketName: 'blobmetadatas'},
    useObjectId: true
  });
}

async function callback({
  getFixture,
  operationParams,
  expectedNextOffset = false,
  user = false,
  expectedToFail = false,
  expectedErrorStatus = 200,
  expectedErrorMessage = ''
}) {
  const mongoUri = await mongoFixtures.getUri();
  await mongoFixtures.populate(getFixture('dbContents.json'));
  const mongoOperator = await createMongoBlobsOperator(mongoUri, '');
  const expectedResult = await getFixture('expectedResult.json');
  try {
    const blobsArray = [];
    const nextOffset = await new Promise((resolve, reject) => {
      const emitter = mongoOperator.queryBlob(operationParams, user);
      emitter.on('blobs', blobs => blobs.forEach(blob => blobsArray.push(blob))) // eslint-disable-line functional/immutable-data
        .on('error', error => reject(error))
        .on('end', nextOffset => resolve(nextOffset));
    });

    // console.log(nextOffset); // eslint-disable-line
    // console.log(expectedNextOffset); // eslint-disable-line
    // console.log(result); // eslint-disable-line
    // console.log(expectedResult); // eslint-disable-line
    expect(nextOffset).to.eql(expectedNextOffset);
    expect(blobsArray).to.eql(expectedResult);
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
