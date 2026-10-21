import {DateTime} from 'luxon';
import createDebugLogger from 'debug';
import sanitize from 'mongo-sanitize';
import type {BlobDocument, MongoBlobsOperator} from './mongoBlobs.ts';
import type {BLOB_STATE} from './constants.ts';

const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:utils');
const debugPolling = debug.extend('poll');
const debugDev = debug.extend('dev');

export interface OfflinePeriodConfig {
  startHour: number;
  lengthHours: number;
}

export interface UserInfo {
  roles: {
    groups: string[];
  };
}

export function isOfflinePeriod(importOfflinePeriod: OfflinePeriodConfig | undefined, nowTime: string | false = false): boolean {
  if (importOfflinePeriod === undefined) {
    return false;
  }

  const {startHour, lengthHours} = importOfflinePeriod;
  const now = nowTime ? DateTime.fromISO(nowTime) : DateTime.local();
  debugDev('now: ', now.toISO());
  const todaysOfflineStart = now.set({hours: startHour, minutes: 0, seconds: 0, milliseconds: 0});
  debugDev('today offline starts: ', todaysOfflineStart.toISO());
  const todaysOfflineEnd = todaysOfflineStart.plus({hours: lengthHours});
  debugDev('today offline ends: ', todaysOfflineEnd.toISO());

  if (now > todaysOfflineStart && now < todaysOfflineEnd) {
    debugDev('Now is todays offline hours!');
    return true;
  }

  if (now > todaysOfflineEnd) {
    debugDev('Now is after todays offline hours!');
    return false;
  }

  const yesterdaysOfflineStart = now.minus({days: 1}).set({hours: startHour, minutes: 0, seconds: 0, milliseconds: 0});
  debugDev('yesterdays offline starts: ', yesterdaysOfflineStart.toISO());
  const yesterdaysOfflineEnd = yesterdaysOfflineStart.plus({hours: lengthHours});
  debugDev('yesterdays offline ends: ', yesterdaysOfflineEnd.toISO());

  if (now < yesterdaysOfflineEnd) {
    debugDev('Now is yesterdays offline hours!');
    return true;
  }

  debugDev('Now is before todays offline hours!');
  return false;
}

export interface BlobQueryParams {
  profile?: string | string[];
  state?: string | string[];
  contentType?: string | string[];
  creationTime?: string;
  modificationTime?: string;
}

export interface BlobQueryDoc {
  profile?: {$in: string[]};
  contentType?: {$in: string[]};
  state?: {$in: string[]};
  creationTime?: {$gte: string; $lte: string};
  modificationTime?: {$gte: string; $lte: string};
}

export function generateBlobQuery(params: BlobQueryParams, user?: UserInfo) {
  const {profile, contentType, state, creationTime, modificationTime} = params;
  const doc: BlobQueryDoc = {...formatProfile(profile, user)};

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
        $gte: formatTime(timestampArray[0]!, 'start'),
        $lte: formatTime(timestampArray[0]!, 'end')
      };
    } else {
      doc.creationTime = {
        $gte: formatTime(timestampArray[0]!, false),
        $lte: formatTime(timestampArray[1]!, false)
      };
    }
  }

  if (modificationTime) {
    const timestampArray = splitAndSanitize(modificationTime);

    if (timestampArray.length === 1) {
      doc.modificationTime = {
        $gte: formatTime(timestampArray[0]!, 'start'),
        $lte: formatTime(timestampArray[0]!, 'end')
      };
    } else {
      doc.modificationTime = {
        $gte: formatTime(timestampArray[0]!, false),
        $lte: formatTime(timestampArray[1]!, false)
      };
    }
  }

  // console.log(JSON.stringify(doc)); // eslint-disable-line
  return doc;

  function splitAndSanitize(value: string | string[]): string[] {
    if (Array.isArray(value)) {
      const cleanValueArray = value.map(valueToSanitize => sanitize(valueToSanitize));
      return cleanValueArray;
    }

    const valueArray = value.split(',');
    const cleanValueArray = valueArray.map(valueToSanitize => sanitize(valueToSanitize));
    return cleanValueArray;
  }

  interface BlobQueryProfileDoc {
    profile?: {$in: string[]};
  }

  function formatProfile(profile: string | string[] | undefined, user?: UserInfo): BlobQueryProfileDoc {
    const profileDoc: BlobQueryProfileDoc = {};
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

  function formatTime(timestamp: string, startOrEndOfDay: 'start' | 'end' | false = false): string {
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

export interface ProfileQueryParams {
  id?: string;
  group?: string;
}

export interface ProfileQuery {
  id?: string;
  groups?: string;
}


export function generateProfileQuery({id, group}: ProfileQueryParams) {
  const doc: ProfileQuery = {};

  if (id) {
    doc.id = sanitize(id);
  }

  if (group) {
    doc.groups = sanitize(group);
  }

  // console.log(JSON.stringify(doc)); // eslint-disable-line
  return doc;
}

export interface NextBlobParams {
  profileIds: string[];
  state: keyof typeof BLOB_STATE;
  importOfflinePeriod?: OfflinePeriodConfig;
}

export async function getNextBlob(mongoOperator: MongoBlobsOperator, params: NextBlobParams, nowTime: string | false = false): Promise<BlobDocument | false> {
  debugPolling('Get next blob');

  if (!isOfflinePeriod(params.importOfflinePeriod, nowTime)) {
    const nextBlob = await new Promise<BlobDocument>((resolve, reject) => {
      debugPolling(`Checking blobs for ${params.profileIds} in ${params.state}`);
      let nextBlob;
      const emitter = mongoOperator.queryBlob({
        limit: 1,
        getAll: false,
        profile: params.profileIds.join(','),
        state: params.state
      });
      emitter.on('blobs', blobs => {
        [nextBlob] = blobs;
      })
        .on('error', error => reject(error))
        .on('end', () => resolve(nextBlob));
    });

    // debug(`No blobs in ${state} found for ${profileIds}`);
    if (nextBlob) {
      return nextBlob;
    }

    debugPolling('No blobs');
    return false;
  }

  debugPolling('Offline period');
  return false;
}
