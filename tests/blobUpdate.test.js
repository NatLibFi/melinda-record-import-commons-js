import assert from 'node:assert';
import {READERS} from '@natlibfi/fixura';
import mongoFixturesFactory from '@natlibfi/fixura-mongo';
import generateTests from '@natlibfi/fixugen';
import {createMongoBlobsOperator} from '../src/mongoBlobs.js';

let mongoFixtures; // eslint-disable-line functional/no-let

generateTests({
  callback,
  path: [import.meta.dirname, '..', 'test-fixtures', 'blob', 'update'],
  recurse: false,
  useMetadataFile: true,
  fixura: {
    failWhenNotFound: true,
    reader: READERS.JSON
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
    rootPath: [import.meta.dirname, '..', 'test-fixtures', 'blob', 'update'],
    gridFS: {bucketName: 'blobmetadatas'},
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
  await mongoFixtures.populate(getFixture('dbContents.json'));
  const mongoOperator = await createMongoBlobsOperator(mongoUri, '');
  const expectedResult = await getFixture('expectedResult.json');
  try {
    await mongoOperator.updateBlob(operationParams);
    const dump = dumpParser(await mongoFixtures.dump());
    assert.deepStrictEqual(dump, expectedResult);
  } catch (error) {
    if (!expectedToFail) {
      throw error;
    }

    // console.log(error); // eslint-disable-line
    assert.equal(error.status, expectedErrorStatus);
    assert.equal(error.payload, expectedErrorMessage);
    assert.equal(expectedToFail, true, 'This is expected to fail');
  }

  function dumpParser(dump) {
    // Drop timestamps
    const blobmetadatas = dump.blobmetadatas.map(blobmetadata => {
      const {_id, modificationTime, creationTime, timestamp, processingInfo, ...rest} = blobmetadata; // eslint-disable-line no-unused-vars
      const {numberOfRecords, failedRecords, importResults} = processingInfo;

      const handledFailedRecords = failedRecords.map(({timestamp, ...rest}) => rest); // eslint-disable-line no-unused-vars
      const handledImportResults = importResults.map(({timestamp, ...rest}) => rest); // eslint-disable-line no-unused-vars
      return {...rest, processingInfo: {numberOfRecords, failedRecords: handledFailedRecords, importResults: handledImportResults}};
    });

    return {blobmetadatas};
  }
}
