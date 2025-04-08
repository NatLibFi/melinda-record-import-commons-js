
import {MarcRecord} from '@natlibfi/marc-record';
import {Error as ApiError} from '@natlibfi/melinda-commons';
import createDebugLogger from 'debug';
import {CHUNK_SIZE} from './constants';
import httpStatus from 'http-status';
import {promisify} from 'util';

export async function createAmqpOperator(amqplib, AMQP_URL) {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:amqp');
  const debugDev = debug.extend('dev');
  const debugData = debug.extend('data');
  const setTimeoutPromise = promisify(setTimeout);

  debug(`Creating an AMQP operator to ${AMQP_URL}`);
  const connection = await amqplib.connect(AMQP_URL);
  const channel = await connection.createChannel();

  debug(`Connection: ${connection}`);
  debug(`Channel: ${channel}`);

  return {deleteQueue, purgeQueue, countQueue, getChunk, getOne, ackMessages, nackMessages, sendToQueue, closeChannel, closeConnection};

  async function closeChannel() {
    debug(`Closing channel`);
    await channel.close();
    debug(`Channel: ${channel}`);
  }

  async function closeConnection() {
    debug(`Closing connection`);
    await connection.close();
    debug(`Connection: ${connection}`);
  }

  // MARK: Delete queue
  /**
   * Delete queue uses blob id and status to form queue id.
   * E.g. PENDING_LOOKUPS.905e283f-2644-4d26-8432-6634fbbc0161
   *
   * @param {Object} params object: blobId, status
   * @param {uuid} params.blobId BlobId for blob to be handled
   * @param {string} params.status Status for queue
   * @param {boolean} allowMessageLoss Allows deleting queue even if queue still has messages
   * @returns {boolean} returns true on succesful delete
   */
  async function deleteQueue({blobId, status}, allowMessageLoss = false) {
    try {
      const {queue, channelInfo} = await generateQueueId({blobId, status});
      const tempChannel = await connection.createChannel();

      if (!allowMessageLoss && channelContainsMessages(channelInfo)) {
        throw new Error('Trying to remove queue that has unhandled messages!');
      }
      // deleteQueue borks the channel if the queue does not exist
      // -> use throwaway tempChannel to avoid killing actual channel in use
      // this might be doable also with assertQueue before deleteQueue
      debug(`Deleteting queue: ${queue}`);
      // The server reply contains a single field, messageCount, with the number of messages deleted or dead-lettered along with the queue.
      const {messageCount} = await tempChannel.deleteQueue(queue);
      debug(`Queue ${queue} had ${messageCount} messages when deleted`);

      if (tempChannel) {
        await tempChannel.close();
        return;
      }

      return true;
    } catch (error) {
      handleAmqpErrors(error);
    }
  }

  // MARK: Purge queue
  /**
   * Purge queue uses blob id and status to form queue id.
   * E.g. PENDING_LOOKUPS.905e283f-2644-4d26-8432-6634fbbc0161
   *
   * @param {Object} params object: blobId, status
   * @param {uuid} params.blobId BlobId for blob to be handled
   * @param {string} params.status Status for queue
   * @returns {boolean} returns true on succesfull purge
   */
  async function purgeQueue({blobId, status}) {
    try {
      const {queue, channelInfo} = await generateQueueId({blobId, status});
      debug(`Purging queue: ${queue}`);
      await channel.purgeQueue(queue);
      debug(`Queue ${queue} has purged ${channelInfo.messageCount} messages`);

      return true;
    } catch (error) {
      handleAmqpErrors(error);
    }
  }

  // MARK: Count queue
  /**
   * Count queue uses blob id and status to form queue id.
   * E.g. PENDING_LOOKUPS.905e283f-2644-4d26-8432-6634fbbc0161
   *
   * @param {Object} params object: blobId, status
   * @param {uuid} params.blobId BlobId for blob to be handled
   * @param {string} params.status Status for queue
   * @returns {number} returns number of messages in queue
   */
  async function countQueue({blobId, status}) {
    try {
      const {queue, channelInfo} = await generateQueueId({blobId, status});
      debug(`Counting queue: ${queue}`);
      return channelInfo.messageCount;
    } catch (error) {
      handleAmqpErrors(error);
    }
  }

  // MARK: Get chunk
  /**
   * Gets 100 messages from queue. CHUNK_SIZE set in constants.
   * Get chunk uses blob id and status to form queue id.
   * E.g. PENDING_LOOKUPS.905e283f-2644-4d26-8432-6634fbbc0161
   *
   * @param {Object} params object: blobId, status
   * @param {uuid} params.blobId BlobId for blob to be handled
   * @param {string} params.status Status for queue
   * @returns {object|boolean} returns {headers, records, messages} or false
   */
  async function getChunk({blobId, status}) {
    try {
      const {queue, channelInfo} = await generateQueueId({blobId, status});
      if (channelContainsMessages(channelInfo)) {
        debug(`Prepared to getChunk from queue: ${queue}`);
        // getData: next chunk (100) messages
        const messages = await getData(queue);

        // Note: headers are from the first message of the chunk
        debug(`getChunk (${messages ? messages.length : '0'} from queue ${queue}) to records`);

        const headers = getHeaderInfo(messages[0]);
        const records = await transformMessagesToRecords(messages);
        return {headers, records, messages};
      }

      return false;
    } catch (error) {
      handleAmqpErrors(error);
    }
  }

  // MARK: Get one
  /**
   * Gets 1 messages from queue.
   * Get one uses blob id and status to form queue id.
   * E.g. PENDING_LOOKUPS.905e283f-2644-4d26-8432-6634fbbc0161
   *
   * @param {Object} params object: blobId, status
   * @param {uuid} params.blobId BlobId for blob to be handled
   * @param {string} params.status Status for queue
   * @returns {object|boolean} returns {headers, records, messages} or false
   */
  async function getOne({blobId, status}) {
    try {
      const {queue, channelInfo} = await generateQueueId({blobId, status});
      if (channelContainsMessages(channelInfo)) {
        debug(`Prepared to getOne from queue: ${queue}`);
        // Returns false if 0 items in queue
        const message = await channel.get(queue);

        // debugData(`Message: ${inspect(message, {colors: true, maxArrayLength: 3, depth: 3})}`);
        // Do not spam the logs

        if (message) {
          debugDev(`Got one from queue: ${queue}`);
          const headers = getHeaderInfo(message);
          const records = transformMessagesToRecords([message]);
          return {headers, records, messages: [message]};
        }

        return false;
      }

      return false;
    } catch (error) {
      handleAmqpErrors(error);
    }
  }

  // MARK: Ack messages
  /**
   * Ack messages - Acknowledge the given messages
   *
   * @param {Array[Object]} messages Array of message objects
   * @returns {void} returns nothing
   */
  async function ackMessages(messages) {
    messages.forEach(message => {
      debugDev(`Ack message ${message.properties.correlationId}`);
      channel.ack(message);
    });
    await setTimeoutPromise(10);
    return;
  }

  // MARK: Nack messages
  /**
   * Nack messages - Reject a messages back to queue
   *
   * @param {Array[Object]} messages Array of message objects
   * @returns {void} returns nothing
   */
  async function nackMessages(messages) {
    messages.forEach(message => {
      debugDev(`Nack message ${message.properties.correlationId}`);
      channel.nack(message, false, true);
    });
    await setTimeoutPromise(10);
    return;
  }

  // MARK: Send to queue
  /**
   * Sends to queue
   * Send to queue uses blob id and status to form queue id.
   * E.g. PENDING_LOOKUPS.905e283f-2644-4d26-8432-6634fbbc0161
   *
   * @param {Object} params object: blobId, status, data
   * @param {uuid} params.blobId BlobId for blob to be handled
   * @param {string} params.status Status for queue
   * @param {object} params.data Data object sent to queue
   * @returns {boolean} returns true on success
   */
  async function sendToQueue({blobId, status, data}) {
    debug(`sendToQueue`);
    // eslint-disable-next-line no-useless-catch
    try {
      const {queue} = await generateQueueId({blobId, status});
      debug(`Queue ${queue}`);
      debugDev(`Queue Asserted: ${queue}`);

      debugData(`Data ${JSON.stringify(data)}`);

      debugDev(`Actually sendToQueue: ${queue}`);
      await channel.sendToQueue(
        queue,
        Buffer.from(JSON.stringify({data})),
        {
          correlationId: blobId,
          persistent: true
        }
      );
      debugDev(`Send message to queue: ${queue}`);

      return true;
    } catch (error) {
      debug(`SendToQueue errored: ${JSON.stringify(error)}`);
      handleAmqpErrors(error);
    }
  }

  // ----------------
  // Helper functions
  // ----------------

  function channelContainsMessages(channelInfo) {
    if (channelInfo.messageCount < 1) {
      debug(`checkQueue: ${channelInfo.messageCount} - queue is empty`);
      return false;
    }
    debug(`Queue has ${channelInfo.messageCount} messages`);
    return true;
  }

  async function generateQueueId({blobId, status}) {
    const isUndefined = blobId === undefined || status === undefined;
    const notString = typeof blobId !== 'string' || typeof status !== 'string';
    const isEmpty = blobId.length < 1 || status.length < 1;
    if (isUndefined || notString || isEmpty) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'invalid operation parameters');
    }
    const queue = `${status}.${blobId}`;
    const channelInfo = await channel.assertQueue(queue, {durable: true});
    return {queue, channelInfo};
  }

  function transformMessagesToRecords(messages) {
    debug(`Parsing messages (${messages.length}) to records`);

    return messages.map(message => {
      const content = JSON.parse(message.content.toString());
      // Use subfieldValues: false validationOption here
      return new MarcRecord(content.data, {subfieldValues: false});
    });
  }

  // MARK: Get data
  /**
  * Gets array of messages from queue. Max length of array is set in CHUNK_SIZE constant.
  * @param {queue} Queue
  * @returns {[message]} returns array of messages
  */
  async function getData(queue) {
    debug(`Getting queue data from ${queue}`);
    try {
      const {messageCount} = await channel.checkQueue(queue);
      debug(`There is ${messageCount} messages in queue ${queue}`);

      const messages = await pump();

      debug(`Returning ${messages.length} messages`);

      return messages;
    } catch (error) {
      handleAmqpErrors(error);
    }

    async function pump(results = []) {
      if (results.length === CHUNK_SIZE) {
        return results;
      }

      const message = await channel.get(queue);

      if (!message) {
        return results;
      }

      return pump([...results, message]);
    }
  }

  function getHeaderInfo(data) {
    return data.properties.headers;
  }

  function handleAmqpErrors(error) {
    debug(`HandleAmqpErrors got an error: ${JSON.stringify(error)}`);
    if (error instanceof ApiError) {
      debug(`We have an ApiError`);
      throw new ApiError(error.status, error.payload);
    }
    debug(`We have a non-ApiError`);
    throw error;
  }
}
