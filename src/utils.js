//import moment from 'moment';
import {add, formatISO, isAfter, isBefore, set, setDefaultOptions} from 'date-fns';
import {fi} from 'date-fns/locale';
import createDebugLogger from 'debug';
import sanitize from 'mongo-sanitize';

const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:utils');
const debugDev = createDebugLogger('@natlibfi/melinda-record-import-commons:utils:dev');

export function isOfflinePeriod(importOfflinePeriod, nowTime = false) {
  if (importOfflinePeriod === undefined) {
    return false;
  }

  setDefaultOptions({weekStartsOn: 1, locale: fi});

  const {startHour, lengthHours} = importOfflinePeriod;
  const now = nowTime ? new Date(nowTime) : new Date();
  debugDev('now: ', formatISO(now)); // eslint-disable-line
  const todaysOfflineStart = set(now, {hours: startHour, minutes: 0, seconds: 0, milliseconds: 0});
  debugDev('today offline starts: ', formatISO(todaysOfflineStart)); // eslint-disable-line
  const todaysOfflineEnd = add(todaysOfflineStart, {hours: lengthHours});
  debugDev('today offline ends: ', formatISO(todaysOfflineEnd)); // eslint-disable-line

  if (isAfter(now, todaysOfflineStart) && isBefore(now, todaysOfflineEnd)) {
    debugDev('Now is todays offline hours!'); // eslint-disable-line
    return true;
  }

  if (isAfter(now, todaysOfflineEnd)) {
    debugDev('Now is after todays offline hours!'); // eslint-disable-line
    return false;
  }

  const yesterdaysOfflineStart = set(add(now, {days: -1}), {hours: startHour, minutes: 0, seconds: 0, milliseconds: 0});
  debugDev('yesterdays offline starts: ', formatISO(yesterdaysOfflineStart)); // eslint-disable-line
  const yesterdaysOfflineEnd = add(yesterdaysOfflineStart, {hours: lengthHours});
  debugDev('yesterdays offline ends: ', formatISO(yesterdaysOfflineEnd)); // eslint-disable-line

  if (isBefore(now, yesterdaysOfflineEnd)) {
    debugDev('Now is yesterdays offline hours!'); // eslint-disable-line
    return true;
  }

  debugDev('Now is before todays offline hours!'); // eslint-disable-line
  return false;
}

export function generateBlobQuery({profile, state, contentType, creationTime, modificationTime, test}, user) {
  const doc = {...formatProfile(profile, user)};

  if (contentType) { // eslint-disable-line functional/no-conditional-statements
    doc.contentType = {$in: splitAndSanitize(contentType)}; // eslint-disable-line functional/immutable-data
  }

  if (state) { // eslint-disable-line functional/no-conditional-statements
    doc.state = {$in: splitAndSanitize(state)}; // eslint-disable-line functional/immutable-data
  }

  if (creationTime) {
    const timestampArray = creationTime.split(',');
    if (timestampArray.length === 1) { // eslint-disable-line functional/no-conditional-statements
      doc.$and = [ // eslint-disable-line functional/immutable-data
        {creationTime: {$gte: formatTime(timestampArray[0], 'start', test)}},
        {creationTime: {$lte: formatTime(timestampArray[0], 'end', test)}}
      ];
    } else { // eslint-disable-line functional/no-conditional-statements
      doc.$and = [ // eslint-disable-line functional/immutable-data
        {creationTime: {$gte: formatTime(timestampArray[0], false, test)}},
        {creationTime: {$lte: formatTime(timestampArray[1], false, test)}}
      ];
    }
  }

  if (modificationTime) {
    const timestampArray = sanitize(modificationTime.split(','));

    if (timestampArray.length === 1) { // eslint-disable-line functional/no-conditional-statements
      doc.$and = [ // eslint-disable-line functional/immutable-data
        {modificationTime: {$gte: formatTime(timestampArray[0], 'start', test)}},
        {modificationTime: {$lte: formatTime(timestampArray[0], 'end', test)}}
      ];
    } else { // eslint-disable-line functional/no-conditional-statements
      doc.$and = [ // eslint-disable-line functional/immutable-data
        {modificationTime: {$gte: formatTime(timestampArray[0], false, test)}},
        {modificationTime: {$lte: formatTime(timestampArray[1], false, test)}}
      ];
    }
  }

  // console.log(JSON.stringify(doc)); // eslint-disable-line
  return doc;

  function splitAndSanitize(value) {
    if (Array.isArray(value)) { // eslint-disable-line functional/no-conditional-statements
      const cleanValueArray = value.map(valueToSanitize => sanitize(valueToSanitize));
      return cleanValueArray;
    }

    const valueArray = value.split(',');
    const cleanValueArray = valueArray.map(valueToSanitize => sanitize(valueToSanitize));
    return cleanValueArray;
  }

  function formatProfile(profile, user) {
    const profileDoc = {};
    if (profile) {
      const cleanProfiles = splitAndSanitize(profile);

      if (user) {
        const userGroups = user.roles.groups;
        const allowedGroups = cleanProfiles.filter(cleanProfile => userGroups.includes(cleanProfile) || userGroups.includes('kvp'));

        if (allowedGroups.length === 0) { // eslint-disable-line functional/no-conditional-statements
          profileDoc.profile = {'$in': userGroups}; // eslint-disable-line functional/immutable-data
        }

        if (allowedGroups.length > 0) { // eslint-disable-line functional/no-conditional-statements
          profileDoc.profile = {'$in': allowedGroups}; // eslint-disable-line functional/immutable-data
        }
      }

      if (!user) { // eslint-disable-line functional/no-conditional-statements
        profileDoc.profile = {'$in': cleanProfiles}; // eslint-disable-line functional/immutable-data
      }
    }

    if (!profile && user) { // eslint-disable-line functional/no-conditional-statements
      const userGroups = user.roles.groups;
      profileDoc.profile = {'$in': userGroups}; // eslint-disable-line functional/immutable-data

      if (userGroups.includes('kvp')) { // eslint-disable-line functional/no-conditional-statements
        delete profileDoc.profile; // eslint-disable-line functional/immutable-data
      }
    }

    return profileDoc;
  }

  function formatTime(timestamp, startOrEndOfDay = false, test = false) {
    if (startOrEndOfDay === 'start') {
      const time = new Date(new Date(timestamp).setUTCHours(0, 0, 0, 0));
      return test ? time.toISOString() : time;
    }

    if (startOrEndOfDay === 'end') {
      const time = new Date(new Date(timestamp).setUTCHours(23, 59, 59, 999));
      return test ? time.toISOString() : time;
    }

    const time = new Date(timestamp);
    return test ? time.toISOString() : time;
  }
}

export function generateProfileQuery({id, group}) {
  const doc = {};

  if (id) { // eslint-disable-line functional/no-conditional-statements
    doc.id = sanitize(id); // eslint-disable-line functional/immutable-data
  }

  if (group) { // eslint-disable-line functional/no-conditional-statements
    doc.groups = sanitize(group); // eslint-disable-line functional/immutable-data
  }

  // console.log(JSON.stringify(doc)); // eslint-disable-line
  return doc;
}

export async function getNextBlob(mongoOperator, {profileIds, state, importOfflinePeriod}, nowTime = false) {
  debug('Get next blob');

  if (!isOfflinePeriod(importOfflinePeriod, nowTime)) {
    const queryResult = [];
    await new Promise((resolve, reject) => {
      debugDev(`Checking blobs for ${profileIds} in ${state}`);
      const emitter = mongoOperator.queryBlob({
        limit: 1,
        getAll: false,
        profile: profileIds.join(','),
        state
      });
      emitter.on('blobs', blobs => blobs.forEach(blob => queryResult.push(blob))) // eslint-disable-line functional/immutable-data
        .on('error', error => reject(error))
        .on('end', () => resolve());
    });

    const [blobInfo] = queryResult;
    // debug(`No blobs in ${state} found for ${profileIds}`);
    if (blobInfo) {
      return blobInfo;
    }

    debugDev('No blobs');
    return false;
  }

  debugDev('Offline period');
  return false;
}
