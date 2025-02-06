
import {MarcRecord} from '@natlibfi/marc-record';
import {Error as ApiError} from '@natlibfi/melinda-commons';
import createDebugLogger from 'debug';
import {CHUNK_SIZE} from './constants';
import {inspect} from 'util';
import httpStatus from 'http-status';

export async function createAmqpOperator(amqplib, AMQP_URL) {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:amqp');
  const debugData = debug.extend('data');

  debug(`Creating an AMQP operator to ${AMQP_URL}`);
  const connection = await amqplib.connect(AMQP_URL);
  const channel = await connection.createChannel();

  debug(`Connection: ${connection}`);
  debug(`Channel: ${channel}`);

  return {purgeQueue, countQueue, getChunk, getOne, ackMessages, nackMessages, sendToQueue, removeQueue, closeChannel, closeConnection};

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

  // MARK: Purge queue
  /**
   * Purge queue uses blob id and status to form queue id.
   * E.g. 905e283f-2644-4d26-8432-6634fbbc0161.PENDING_LOOKUPS
   *
   * @param {Object} params object: blobId, status
   * @param {uuid} params.blobId BlobId for blob to be handled
   * @param {string} params.status Status for queue
   * @returns {boolean} returns true on succesfull purge
   */
  async function purgeQueue({blobId, status}) {
    const queue = generateQueueId({blobId, status});
    debug(`checkQueue: ${queue} and purge`);
    try {

      errorUndefinedQueue(queue);
      const channelInfo = await channel.assertQueue(queue, {durable: true});
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
   * E.g. 905e283f-2644-4d26-8432-6634fbbc0161.PENDING_LOOKUPS
   *
   * @param {Object} params object: blobId, status
   * @param {uuid} params.blobId BlobId for blob to be handled
   * @param {string} params.status Status for queue
   * @returns {number} returns number of messages in queue
   */
  async function countQueue({blobId, status}) {
    const queue = generateQueueId({blobId, status});
    try {
      errorUndefinedQueue(queue);
      const channelInfo = await channel.assertQueue(queue, {durable: true});
      return channelInfo.messageCount;
    } catch (error) {
      handleAmqpErrors(error);
    }
  }

  // MARK: Get chunk
  /**
   * Gets 100 messages from queue. CHUNK_SIZE set in constants.
   * Get chunk uses blob id and status to form queue id.
   * E.g. 905e283f-2644-4d26-8432-6634fbbc0161.PENDING_LOOKUPS
   *
   * @param {Object} params object: blobId, status
   * @param {uuid} params.blobId BlobId for blob to be handled
   * @param {string} params.status Status for queue
   * @returns {object|boolean} returns {headers, records, messages} or false
   */
  async function getChunk({blobId, status}) {
    const queue = generateQueueId({blobId, status});
    try {
      errorUndefinedQueue(queue);
      const channelInfo = await channel.assertQueue(queue, {durable: true});
      if (checkMessageCount(channelInfo)) {
        debug(`Prepared to getChunk from queue: ${queue}`);
        // getData: next chunk (100) messages
        const messages = await getData(queue);

        // Note: headers are from the first message of the chunk
        debug(`getChunk (${messages ? messages.length : '0'} from queue ${queue}) to records`);

        const headers = getHeaderInfo(messages[0]);
        const records = await messagesToRecords(messages);
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
   * E.g. 905e283f-2644-4d26-8432-6634fbbc0161.PENDING_LOOKUPS
   *
   * @param {Object} params object: blobId, status
   * @param {uuid} params.blobId BlobId for blob to be handled
   * @param {string} params.status Status for queue
   * @returns {object|boolean} returns {headers, records, messages} or false
   */
  async function getOne({blobId, status}) {
    const queue = generateQueueId({blobId, status});
    try {
      errorUndefinedQueue(queue);
      const channelInfo = await channel.assertQueue(queue, {durable: true});
      if (checkMessageCount(channelInfo)) {
        debug(`Prepared to getOne from queue: ${queue}`);
        // Returns false if 0 items in queue
        const message = await channel.get(queue);

        // debugData(`Message: ${inspect(message, {colors: true, maxArrayLength: 3, depth: 3})}`);
        // Do not spam the logs

        if (message) {
          debug(`Got one from queue: ${queue}`);
          const headers = getHeaderInfo(message);
          const records = messagesToRecords([message]);
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
   * Ack messages
   *
   * @param {Array[Object]} messages Array of message objects
   * @returns {void} returns nothing
   */
  function ackMessages(messages) {
    messages.forEach(message => {
      debug(`Ack message ${message.properties.correlationId}`);
      channel.ack(message);
    });
  }

  // MARK: Nack messages
  /**
   * Nack messages
   *
   * @param {Array[Object]} messages Array of message objects
   * @returns {void} returns nothing
   */
  function nackMessages(messages) {
    messages.forEach(message => {
      debug(`Nack message ${message.properties.correlationId}`);
      channel.nack(message);
    });
  }

  // MARK: Send to queue
  /**
   * Sends to queue
   * Send to queue uses blob id and status to form queue id.
   * E.g. 905e283f-2644-4d26-8432-6634fbbc0161.PENDING_LOOKUPS
   *
   * @param {Object} params object: blobId, status, data
   * @param {uuid} params.blobId BlobId for blob to be handled
   * @param {string} params.status Status for queue
   * @param {object} params.data Data object sent to queue
   * @returns {boolean} returns true on success
   */
  async function sendToQueue({blobId, status, data}) {
    const queue = generateQueueId({blobId, status});
    debug(`sendToQueue`);
    // eslint-disable-next-line no-useless-catch
    try {
      debug(`Queue ${queue}`);
      debugData(`Data ${JSON.stringify(data)}`);

      errorUndefinedQueue(queue);

      debug(`Asserting queue: ${queue}`);
      await channel.assertQueue(queue, {durable: true});

      debug(`Actually sendToQueue: ${queue}`);
      await channel.sendToQueue(
        queue,
        Buffer.from(JSON.stringify({data})),
        {
          correlationId: blobId,
          persistent: true
        }
      );
      debug(`Send message to queue: ${queue}`);

      return true;
    } catch (error) {
      const errorToThrow = error;
      //if (error instanceof ApiError) {
      //  throw error;
      //}
      debug(`SendToQueue errored: ${JSON.stringify(error)}`);
      handleAmqpErrors(errorToThrow);
    }
  }

  async function removeQueue({blobId, status}) {
    const queue = generateQueueId({blobId, status});
    // deleteQueue borks the channel if the queue does not exist
    // -> use throwaway tempChannel to avoid killing actual channel in use
    // this might be doable also with assertQueue before deleteQueue
    const tempChannel = await connection.createChannel();
    debug(`Removing queue ${queue}.`);
    await tempChannel.deleteQueue(queue);

    if (tempChannel) {
      await tempChannel.close();
      return;
    }

    return;
  }

  // ----------------
  // Helper functions
  // ----------------

  function checkMessageCount(channelInfo) {
    if (channelInfo.messageCount < 1) {
      debug(`checkQueue: ${channelInfo.messageCount} - queue is empty`);
      return false;
    }
    debug(`Queue has ${channelInfo.messageCount} messages`);
    return true;
  }

  function generateQueueId({blobId, status}) {
    if (blobId === undefined || status === undefined || blobId.length < 1 || status.length < 1) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'invalid operation parametters');
    }

    return `${blobId}.${status}`;
  }

  function messagesToRecords(messages) {
    debug(`Parsing messages (${messages.length}) to records`);

    return messages.map(message => {
      const content = JSON.parse(message.content.toString());
      // Use subfieldValues: false validationOption here
      return new MarcRecord(content.data, {subfieldValues: false});
    });
  }

  async function getData(queue) {
    debug(`Getting queue data from ${queue}`);
    try {
      const {messageCount} = await channel.checkQueue(queue);
      debug(`There is ${messageCount} messages in queue ${queue}`);
      const messagesToGet = messageCount >= CHUNK_SIZE ? CHUNK_SIZE : messageCount;
      debug(`Getting ${messagesToGet} messages from queue ${queue}`);

      const messages = await pump(messagesToGet);

      debug(`Returning ${messages.length} unique messages`);

      return messages;
    } catch (error) {
      handleAmqpErrors(error);
    }

    async function pump(count, results = [], identifiers = []) {
      if (count === 0) {
        return results;
      }

      const message = await channel.get(queue);
      const identifier = {
        correlationId: message.properties.correlationId,
        deliveryTag: message.fields.deliveryTag
      };
      // Filter not unique messages
      if (identifiers.includes(identifier)) {
        return pump(count - 1, results, identifiers);
      }

      return pump(count - 1, results.concat(message), identifiers.concat(identifier));
    }
  }

  function getHeaderInfo(data) {
    return data.properties.headers;
  }

  function errorUndefinedQueue(queue) {
    if (queue === undefined || queue === '' || queue === null) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Undefined queue!`);
    }
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
