//import moment from 'moment';
import {add, formatISO, isAfter, isBefore, set, setDefaultOptions} from 'date-fns';
import {fi} from 'date-fns/locale';
import createDebugLogger from 'debug';

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

export async function getNextBlobId(riApiClient, {profileIds, state, importOfflinePeriod}) {
  debugDev(`Checking blobs for ${profileIds} in ${state}`);
  let result = ''; // eslint-disable-line functional/no-let

  try {
    result = await processBlobs({
      client: riApiClient,
      query: {state},
      processCallback,
      messageCallback: count => `${count} blobs in ${state} for ${profileIds}`,
      filter: (blob) => profileIds.some(profileId => profileId === blob.profile)
    });

    // Returns false or blob id
    return result;
  } catch (error) {
    debug(error);
  }

  function processBlobs({client, query, processCallback, messageCallback, updateState = false, filter = () => true}) {
    return new Promise((resolve, reject) => {
      const wantedBlobs = [];

      const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:processBlobs:dev');
      const emitter = client.getBlobs(query);

      emitter
        .on('error', error => {
          debug(error);
          reject(error);
        })
        .on('blobs', blobs => {
          const filteredBlobs = blobs.filter(filter);
          filteredBlobs.forEach(blob => wantedBlobs.push(blob)); // eslint-disable-line functional/immutable-data
        })
        .on('end', () => {
          if (messageCallback) { // eslint-disable-line functional/no-conditional-statements
            debugDev(messageCallback(wantedBlobs.length));
          }
          const result = processCallback(wantedBlobs, updateState);
          resolve(result);
        });
    });
  }

  function processCallback(blobs) {
    const [blob] = blobs;

    if (blob === undefined || isOfflinePeriod(importOfflinePeriod)) {
      debugDev('No blobs or offline period');
      return false;
    }

    const {id, profile, correlationId} = blob;

    return {id, profile, correlationId};
  }
}
