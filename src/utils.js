import moment from 'moment';
import createDebugLogger from 'debug';

export function isOfflinePeriod(importOfflinePeriod) {
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

export function processBlobs({client, query, processCallback, messageCallback, updateState = false, filter = () => true}) {
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
        if (messageCallback) { // eslint-disable-line functional/no-conditional-statement
          debug(messageCallback(wantedBlobs.length));
        }
        const result = processCallback(wantedBlobs, updateState);

        resolve(result);
      });
  });
}
