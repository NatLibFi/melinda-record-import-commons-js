import {expect} from 'chai';
import {READERS} from '@natlibfi/fixura';
import mongoFixturesFactory from '@natlibfi/fixura-mongo';
import generateTests from '@natlibfi/fixugen';
import {createMongoProfilesOperator} from './mongoProfiles.js';

let mongoFixtures; // eslint-disable-line functional/no-let

generateTests({
  callback,
  path: [__dirname, '..', 'test-fixtures', 'queryProfile'],
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
    rootPath: [__dirname, '..', 'test-fixtures', 'queryProfile'],
    useObjectId: true
  });
}

async function callback({
  getFixture,
  operationParams,
  expectedNextOffset = false,
  expectedToFail = false,
  expectedErrorStatus = 200,
  expectedErrorMessage = ''
}) {
  const mongoUri = await mongoFixtures.getUri();
  await mongoFixtures.populate(getFixture({components: ['dbContents.json'], reader: READERS.JSON}));
  const mongoOperator = await createMongoProfilesOperator(mongoUri, {db: '', collection: 'profiles'});
  const expectedResult = await getFixture({components: ['expectedResult.json'], reader: READERS.JSON});
  try {
    const profilesArray = [];
    const nextOffset = await new Promise((resolve, reject) => {
      const emitter = mongoOperator.queryProfile(operationParams);
      emitter.on('profiles', profiles => profiles.forEach(profile => profilesArray.push(profile))) // eslint-disable-line functional/immutable-data
        .on('error', error => reject(error))
        .on('end', nextOffset => resolve(nextOffset));
    });

    // console.log(nextOffset); // eslint-disable-line
    // console.log(expectedNextOffset); // eslint-disable-line
    // console.log(result); // eslint-disable-line
    // console.log(expectedResult); // eslint-disable-line
    expect(nextOffset).to.eql(expectedNextOffset);
    expect(profilesArray).to.eql(expectedResult);
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
