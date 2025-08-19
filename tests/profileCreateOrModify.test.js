import assert from 'node:assert';
import {READERS} from '@natlibfi/fixura';
import mongoFixturesFactory from '@natlibfi/fixura-mongo';
import generateTests from '@natlibfi/fixugen';
import {createMongoProfilesOperator} from '../src/mongoProfiles.js';

let mongoFixtures; // eslint-disable-line functional/no-let

generateTests({
  callback,
  path: [import.meta.dirname, '..', 'test-fixtures', 'createOrModifyProfile'],
  recurse: false,
  useMetadataFile: true,
  fixura: {
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
    rootPath: [import.meta.dirname, '..', 'test-fixtures', 'createOrModifyProfile'],
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
  const mongoOperator = await createMongoProfilesOperator(mongoUri, '');
  const expectedResult = await getFixture({components: ['expectedResult.json'], reader: READERS.JSON});
  try {
    await mongoOperator.createOrModifyProfile(operationParams);
    const dump = await mongoFixtures.dump();
    assert.deepEqual(dump, expectedResult);
  } catch (error) {
    if (!expectedToFail) {
      throw error;
    }

    // console.log(error); // eslint-disable-line
    assert.equal(error.status, expectedErrorStatus);
    assert.equal(error.payload, expectedErrorMessage);
    assert.equal(expectedToFail, true, 'This is expected to fail');
  }
}
