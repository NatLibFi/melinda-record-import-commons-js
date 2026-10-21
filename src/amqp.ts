
import {MarcRecord} from '@natlibfi/marc-record';
import {Error as ApiError} from '@natlibfi/melinda-commons';
import createDebugLogger from 'debug';
import httpStatus from 'http-status';
import {setTimeout} from 'node:timers/promises';
import {CHUNK_SIZE} from './constants.ts';
import type {ChannelModel, Channel, Message, Replies, MessagePropertyHeaders} from 'amqplib'

export interface QueueParams {
  blobId: string;
  status: string;
}

export interface GenerateQueueIdResult {
  queue: string;
  channelInfo: {messageCount: number};
}

export interface SendDataParams {
  blobId: string;
  status: string;
  data: string;
}

export interface GetResult {
  headers: MessagePropertyHeaders;
  records: MarcRecord[];
  messages: Message[];
}

export interface AmqpOperator {
  deleteQueue(params: QueueParams, allowMessageLoss?: boolean): Promise<true | void>;
  purgeQueue(params: QueueParams): Promise<true | void>;
  countQueue(params: QueueParams): Promise<number | void>;
  getChunk(params: QueueParams): Promise<GetResult | false | void>;
  getOne(params: QueueParams): Promise<GetResult | false | void>;
  ackMessages(messages: Message[]): void;
  nackMessages(messages: Message[]): void;
  sendToQueue(params: SendDataParams): Promise<boolean | void>;
  closeChannel(): Promise<void>;
  closeConnection(): Promise<void>;
}

export async function createAmqpOperator(
  amqplib,
  AMQP_URL: string,
): Promise<AmqpOperator> {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:amqp');
  const debugDev = debug.extend('dev');
  const debugData = debug.extend('data');

  let channel: Channel | undefined;

  debug(`Creating an AMQP operator to ${AMQP_URL}`);
  const connection: ChannelModel = await amqplib.connect(AMQP_URL, {
    recovery: {
      initialDelay: 200,
      maxDelay: 30000,
      factor: 2,
      jitter: 0.2,
      maxRetries: 5,
      setup: async (connection: ChannelModel) => {
        channel = await connection.createChannel();
      }
    }
  });
  channel = await connection!.createChannel();

  debug(`Connection: ${connection}`);
  debug(`Channel: ${channel}`);

  return {deleteQueue, purgeQueue, countQueue, getChunk, getOne, ackMessages, nackMessages, sendToQueue, closeChannel, closeConnection};

  async function closeChannel(): Promise<void> {
    debug(`Closing channel`);
    await channel?.close();
    debug(`Channel: ${channel}`);
  }

  async function closeConnection(): Promise<void> {
    debug(`Closing connection`);
    await connection?.close();
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
  async function deleteQueue(params: QueueParams, allowMessageLoss = false): Promise<true | void> {
    try {
      const {queue, channelInfo} = await generateQueueId(params);
      const tempChannel = await connection!.createChannel();

      if (!allowMessageLoss && channelContainsMessages(channelInfo)) {
        throw new Error('Trying to remove queue that has unhandled messages!');
      }
      // deleteQueue borks the channel if the queue does not exist
      // -> use throwaway tempChannel to avoid killing actual channel in use
      // this might be doable also with assertQueue before deleteQueue
      debug(`Deleteting queue: ${queue}`);
      // The server reply contains a single field, messageCount, with the number of messages deleted or dead-lettered along with the queue.
      const {messageCount}: Replies.DeleteQueue = await tempChannel.deleteQueue(queue);
      debug(`Queue ${queue} had ${messageCount} messages when deleted`);

      if (tempChannel) {
        await tempChannel.close();
        return true;
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
  async function purgeQueue(params: QueueParams): Promise<true | void> {
    try {
      const {queue, channelInfo} = await generateQueueId(params);
      debug(`Purging queue: ${queue}`);
      await channel!.purgeQueue(queue);
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
  async function countQueue(params: QueueParams): Promise<number | void> {
    try {
      const {queue, channelInfo} = await generateQueueId(params);
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
  async function getChunk(params: QueueParams): Promise<false | GetResult | void> {
    try {
      const {queue, channelInfo} = await generateQueueId(params);
      if (channelContainsMessages(channelInfo)) {
        debug(`Prepared to getChunk from queue: ${queue}`);
        // getData: next chunk (100) messages
        const messages: Message[] = await getData(queue) ?? [];

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
  async function getOne(params: QueueParams): Promise<false | GetResult | void> {
    try {
      const {queue, channelInfo} = await generateQueueId(params);
      if (channelContainsMessages(channelInfo)) {
        debug(`Prepared to getOne from queue: ${queue}`);
        // Returns false if 0 items in queue
        const message: Message | boolean = await channel!.get(queue);

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
  async function ackMessages(messages: Message[]) {
    messages.forEach(message => {
      debugDev(`Ack message ${message.properties.correlationId}`);
      channel!.ack(message);
    });
    await setTimeout(10);
    return;
  }

  // MARK: Nack messages
  /**
   * Nack messages - Reject a messages back to queue
   *
   * @param {Array[Object]} messages Array of message objects
   * @returns {void} returns nothing
   */
  async function nackMessages(messages: Message[]) {
    messages.forEach(message => {
      debugDev(`Nack message ${message.properties.correlationId}`);
      channel!.nack(message, false, true);
    });
    await setTimeout(10);
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
  async function sendToQueue(params: SendDataParams): Promise<true | void> {
    debug(`sendToQueue`);

    try {
      const {queue} = await generateQueueId(params);
      debug(`Queue ${queue}`);
      debugDev(`Queue Asserted: ${queue}`);

      debugData(`Data ${JSON.stringify(params.data)}`);

      debugDev(`Actually sendToQueue: ${queue}`);
      await channel!.sendToQueue(
        queue,
        Buffer.from(JSON.stringify({data: params.data})),
        {
          correlationId: params.blobId,
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

  function channelContainsMessages(channelInfo: {messageCount: number}): boolean {
    if (channelInfo.messageCount < 1) {
      debug(`checkQueue: ${channelInfo.messageCount} - queue is empty`);
      return false;
    }
    debug(`Queue has ${channelInfo.messageCount} messages`);
    return true;
  }

  async function generateQueueId(params: QueueParams): Promise<GenerateQueueIdResult> {
    const {blobId, status} = params;
    const isUndefined = blobId === undefined || status === undefined;
    const notString = typeof blobId !== 'string' || typeof status !== 'string';
    const isEmpty = blobId.length < 1 || status.length < 1;

    if (isUndefined || notString || isEmpty) {
      throw new ApiError(httpStatus['INTERNAL_SERVER_ERROR'] as number, 'invalid operation parameters');
    }

    const queue = `${status}.${blobId}`;
    const channelInfo: Replies.AssertQueue = await channel!.assertQueue(queue, {durable: true});
    return {queue, channelInfo};
  }

  function transformMessagesToRecords(messages: Message[]): MarcRecord[] {
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
  async function getData(queue): Promise<Message[] | void> {
    debug(`Getting queue data from ${queue}`);
    try {
      const {messageCount}: Replies.AssertQueue = await channel!.assertQueue(queue);
      debug(`There is ${messageCount} messages in queue ${queue}`);

      const messages = await pump();

      debug(`Returning ${messages.length} messages`);

      return messages;
    } catch (error) {
      handleAmqpErrors(error);
    }

    async function pump(results: Message[] = []) {
      if (results.length === CHUNK_SIZE) {
        return results;
      }

      const message: Message | false = await channel!.get(queue);

      if (!message) {
        return results;
      }

      return pump([...results, message]);
    }
  }

  function getHeaderInfo(data): MessagePropertyHeaders {
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
