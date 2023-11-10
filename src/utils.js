import moment from 'moment';
import createDebugLogger from 'debug';
import prettyPrint from 'pretty-print-ms';

const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:utils');

export function logWait(logger, waitTime) {
  // 900000 ms = 15 min
  if (waitTime % 900000 === 0) {
    return logger.verbose(`Total wait: ${prettyPrint(waitTime)}`);
  }
  // 60000ms = 1min
  if (waitTime % 60000 === 0) {
    return logger.debug(`Total wait: ${prettyPrint(waitTime)}`);
  }
  return logger.silly(`Total wait: ${prettyPrint(waitTime)}`);
}

export function isOfflinePeriod(importOfflinePeriod) {
  if (importOfflinePeriod === undefined) {
    return false;
  }

  const {startHour, lengthHours} = importOfflinePeriod;
  const now = moment();

  if (startHour !== undefined && lengthHours !== undefined) {
    if (now.hour() < startHour) {
      const start = moment(now).hour(startHour).subtract(1, 'days');
      return check(start);
    }

    const start = moment(now).hour(startHour);
    return check(start);
  }

  function check(startTime) {
    const endTime = moment(startTime).add(lengthHours, 'hours');
    return now >= startTime && now < endTime;
  }
}

export async function getNextBlobId(riApiClient, {profileIds, state, importOfflinePeriod}) {
  debug(`Checking blobs for ${profileIds} in ${state}`);
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

      const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:processBlobs');
      const emitter = client.getBlobs(query);

      emitter
        .on('error', reject)
        .on('blobs', blobs => {
          const filteredBlobs = blobs.filter(filter);
          filteredBlobs.forEach(blob => wantedBlobs.push(blob)); // eslint-disable-line functional/immutable-data
        })
        .on('end', () => {
          if (messageCallback) { // eslint-disable-line functional/no-conditional-statements
            debug(messageCallback(wantedBlobs.length));
          }
          const result = processCallback(wantedBlobs, updateState);

          resolve(result);
        });
    });
  }

  function processCallback(blobs) {
    const [blob] = blobs;

    if (blob === undefined || isOfflinePeriod(importOfflinePeriod)) {
      debug('No blobs or offline period');
      return false;
    }

    const {id, profile, correlationId} = blob;

    return {id, profile, correlationId};
  }
}

export async function closeAmqpResources({connection, channel}) {
  if (channel) {
    await channel.close();
    await closeConnection();
    return;
  }

  await closeConnection();

  function closeConnection() {
    if (connection) {
      return connection.close();
    }
  }
}
