//import moment from 'moment';
import {add, formatISO, isAfter, isBefore, set, setDefaultOptions} from 'date-fns';
import {fi} from 'date-fns/locale';
import createDebugLogger from 'debug';
import sanitize from 'mongo-sanitize';

const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:utils');
const debugPolling = debug.extend('poll');
const debugDev = debug.extend('dev');

export function isOfflinePeriod(importOfflinePeriod, nowTime = false) {
  if (importOfflinePeriod === undefined) {
    return false;
  }

  setDefaultOptions({weekStartsOn: 1, locale: fi});

  const {startHour, lengthHours} = importOfflinePeriod;
  const now = nowTime ? new Date(nowTime) : new Date();
  debugDev('now: ', formatISO(now));
  const todaysOfflineStart = set(now, {hours: startHour, minutes: 0, seconds: 0, milliseconds: 0});
  debugDev('today offline starts: ', formatISO(todaysOfflineStart));
  const todaysOfflineEnd = add(todaysOfflineStart, {hours: lengthHours});
  debugDev('today offline ends: ', formatISO(todaysOfflineEnd));

  if (isAfter(now, todaysOfflineStart) && isBefore(now, todaysOfflineEnd)) {
    debugDev('Now is todays offline hours!');
    return true;
  }

  if (isAfter(now, todaysOfflineEnd)) {
    debugDev('Now is after todays offline hours!');
    return false;
  }

  const yesterdaysOfflineStart = set(add(now, {days: -1}), {hours: startHour, minutes: 0, seconds: 0, milliseconds: 0});
  debugDev('yesterdays offline starts: ', formatISO(yesterdaysOfflineStart));
  const yesterdaysOfflineEnd = add(yesterdaysOfflineStart, {hours: lengthHours});
  debugDev('yesterdays offline ends: ', formatISO(yesterdaysOfflineEnd));

  if (isBefore(now, yesterdaysOfflineEnd)) {
    debugDev('Now is yesterdays offline hours!');
    return true;
  }

  debugDev('Now is before todays offline hours!');
  return false;
}

export function generateBlobQuery({profile, state, contentType, creationTime, modificationTime}, user) {
  const doc = {...formatProfile(profile, user)};

  if (contentType) {
    doc.contentType = {$in: splitAndSanitize(contentType)};
  }

  if (state) {
    doc.state = {$in: splitAndSanitize(state)};
  }

  if (creationTime) {
    const timestampArray = splitAndSanitize(creationTime);
    if (timestampArray.length === 1) {
      doc.creationTime = {
        $gte: formatTime(timestampArray[0], 'start'),
        $lte: formatTime(timestampArray[0], 'end')
      };
    } else {
      doc.creationTime = {
        $gte: formatTime(timestampArray[0], false),
        $lte: formatTime(timestampArray[1], false)
      };
    }
  }

  if (modificationTime) {
    const timestampArray = splitAndSanitize(modificationTime);

    if (timestampArray.length === 1) {
      doc.modificationTime = {
        $gte: formatTime(timestampArray[0], 'start'),
        $lte: formatTime(timestampArray[0], 'end')
      };
    } else {
      doc.modificationTime = {
        $gte: formatTime(timestampArray[0], false),
        $lte: formatTime(timestampArray[1], false)
      };
    }
  }

  // console.log(JSON.stringify(doc)); // eslint-disable-line
  return doc;

  function splitAndSanitize(value) {
    if (Array.isArray(value)) {
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

        if (allowedGroups.length === 0) {
          profileDoc.profile = {'$in': userGroups};
        }

        if (allowedGroups.length > 0) {
          profileDoc.profile = {'$in': allowedGroups};
        }
      }

      if (!user) {
        profileDoc.profile = {'$in': cleanProfiles};
      }
    }

    if (!profile && user) {
      const userGroups = user.roles.groups;
      profileDoc.profile = {'$in': userGroups};

      if (userGroups.includes('kvp')) {
        delete profileDoc.profile;
      }
    }

    return profileDoc;
  }

  function formatTime(timestamp, startOrEndOfDay = false) {
    if (startOrEndOfDay === 'start') {
      const time = new Date(new Date(timestamp).setUTCHours(0, 0, 0, 0));
      return time.toISOString();
    }

    if (startOrEndOfDay === 'end') {
      const time = new Date(new Date(timestamp).setUTCHours(23, 59, 59, 999));
      return time.toISOString();
    }

    const time = new Date(timestamp);
    return time.toISOString();
  }
}

export function generateProfileQuery({id, group}) {
  const doc = {};

  if (id) {
    doc.id = sanitize(id);
  }

  if (group) {
    doc.groups = sanitize(group);
  }

  // console.log(JSON.stringify(doc)); // eslint-disable-line
  return doc;
}

export async function getNextBlob(mongoOperator, {profileIds, state, importOfflinePeriod}, nowTime = false) {
  debugPolling('Get next blob');

  if (!isOfflinePeriod(importOfflinePeriod, nowTime)) {
    const queryResult = [];
    await new Promise((resolve, reject) => {
      debugPolling(`Checking blobs for ${profileIds} in ${state}`);
      const emitter = mongoOperator.queryBlob({
        limit: 1,
        getAll: false,
        profile: profileIds.join(','),
        state
      });
      emitter.on('blobs', blobs => blobs.forEach(blob => queryResult.push(blob)))
        .on('error', error => reject(error))
        .on('end', () => resolve());
    });

    const [blobInfo] = queryResult;
    // debug(`No blobs in ${state} found for ${profileIds}`);
    if (blobInfo) {
      return blobInfo;
    }

    debugPolling('No blobs');
    return false;
  }

  debugPolling('Offline period');
  return false;
}
