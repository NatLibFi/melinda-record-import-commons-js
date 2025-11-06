import assert from 'node:assert';
import {READERS} from '@natlibfi/fixura';
import mongoFixturesFactory from '@natlibfi/fixura-mongo';
import generateTests from '@natlibfi/fixugen';
import {createMongoBlobsOperator} from '../src/mongoBlobs.js';

let mongoFixtures; // eslint-disable-line functional/no-let

generateTests({
  callback,
  path: [import.meta.dirname, '..', 'test-fixtures', 'blob', 'create'],
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
    rootPath: [import.meta.dirname, '..', 'test-fixtures', 'blob', 'create'],
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
    const blobContentStream = getFixture({components: ['blobContent'], reader: READERS.STREAM});
    await mongoOperator.createBlob(operationParams, blobContentStream);
    const dump = dumpParser(await mongoFixtures.dump());
    assert.deepEqual(dump, expectedResult);
    assert.equal(expectedToFail, false, 'This is expected to succes');
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
    return {
      blobmetadatas: dump.blobmetadatas,
      'blobmetadatas.files': dump['blobmetadatas.files'].map(({filename}) => ({filename}))
    };
  }
}
