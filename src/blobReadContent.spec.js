import {expect} from 'chai';
import {READERS} from '@natlibfi/fixura';
import mongoFixturesFactory from '@natlibfi/fixura-mongo';
import generateTests from '@natlibfi/fixugen';
import {createMongoBlobsOperator} from './mongoBlobs.js';

let mongoFixtures; // eslint-disable-line functional/no-let

generateTests({
  callback,
  path: [__dirname, '..', 'test-fixtures', 'blob', 'readContent'],
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
    rootPath: [__dirname, '..', 'test-fixtures', 'blob', 'readContent'],
    gridFS: {bucketName: 'blobmetadatas'},
    useObjectId: true
  });
}

async function callback({
  getFixture,
  operationParams,
  expectedToFail = false,
  expectedErrorMessage = ''
}) {
  const mongoUri = await mongoFixtures.getUri();
  await mongoFixtures.populate(getFixture('dbContents.json'));
  await mongoFixtures.populateFiles(getFixture('dbFiles.json'));
  const expectedResult = await getFixture('expectedResult.json');

  try {
    const mongoOperator = await createMongoBlobsOperator(mongoUri, '');
    const readStream = await mongoOperator.readBlobContent(operationParams);
    const fileContentText = await getData(readStream);
    const result = JSON.parse(fileContentText);
    expect(result).to.eql(expectedResult);
    expect(expectedToFail, 'This is expected to succes').to.equal(false);
  } catch (error) {
    if (!expectedToFail) {
      throw error;
    }
    // console.log(error); // eslint-disable-line
    expect(error.message).to.eql(expectedErrorMessage);
    expect(expectedToFail).to.eql(true, 'This test is not suppose to fail!');
  }

  function getData(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];

      stream
        .setEncoding('utf8')
        .on('error', reject)
        .on('data', chunk => chunks.push(chunk)) // eslint-disable-line functional/immutable-data
        .on('end', () => resolve(chunks.join('')));
    });
  }
}
