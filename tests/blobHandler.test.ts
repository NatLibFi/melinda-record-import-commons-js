import assert from 'node:assert';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';

import createBlobHandler from '../src/transformer/blobHandler.ts';
import {BLOB_STATE, BLOB_UPDATE_OPERATIONS} from '../src/constants.ts';

import type {AmqpOperator} from '../src/amqp.ts';
import type {MongoBlobsOperator} from '../src/mongoBlobs.ts';
import type {ProcessHandler, RecordPayload} from '../src/transformer/blobHandler.ts';

const BLOB_ID = 'test-blob-aaa-111-bbb';
const NEXT_STATUS = BLOB_STATE.TRANSFORMED;

function createAmqpError(message = 'Channel closed') {
  const error = new Error(message);
  error.name = 'IllegalOperationError';
  return error;
}

interface MongoMock {
  operator: MongoBlobsOperator;
  updateBlobCalls: {id: string; payload: Record<string, unknown>}[];
}

function createMongoMock(overrides: Partial<Record<string, unknown>> = {}): MongoMock {
  const updateBlobCalls: MongoMock['updateBlobCalls'] = [];
  const operator = {
    async updateBlob(params: {id: string; payload: Record<string, unknown>}) {
      updateBlobCalls.push(params);
      return true;
    },
    async readBlobContent({id}: {id: string}) {
      return Readable.from([`content of ${id}`]);
    },
    ...overrides
  } as unknown as MongoBlobsOperator;
  return {operator, updateBlobCalls};
}

interface AmqpMock {
  operator: AmqpOperator;
  sendToQueueCalls: {blobId: string; status: string; data: unknown}[];
}

function createAmqpMock(overrides: Partial<Record<string, unknown>> = {}): AmqpMock {
  const sendToQueueCalls: AmqpMock['sendToQueueCalls'] = [];
  const operator = {
    async sendToQueue(params: {blobId: string; status: string; data: unknown}) {
      sendToQueueCalls.push(params);
      return true;
    },
    async purgeQueue() {
      return true;
    },
    ...overrides
  } as unknown as AmqpOperator;
  return {operator, sendToQueueCalls};
}

function installExitStub() {
  const calls: number[] = [];
  let resolveExit: ((code: number) => void) | undefined;
  const exitPromise = new Promise<number>(resolve => {
    resolveExit = resolve;
  });
  process.exit = ((code?: number) => {
    const exitCode = code ?? 0;
    calls.push(exitCode);
    resolveExit?.(exitCode);
  }) as unknown as typeof process.exit;
  return {calls, exitPromise};
}

function emitRecordThenEnd(): ProcessHandler {
  return async () => {
    const emitter = new EventEmitter();
    // Emit asynchronously: the blobHandler attaches listeners after processHandler returns
    setImmediate(() => {
      emitter.emit('record', {failed: false, record: 'record-1', error: null, incNumberOfRecords: false});
      emitter.emit('end');
    });
    return emitter;
  };
}

function transformFailureCalls(calls: MongoMock['updateBlobCalls']) {
  return calls.filter(call => call.payload.op === BLOB_UPDATE_OPERATIONS.transformationFailed);
}

async function tick(ms = 25) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

test('normal flow: records queued, blob state updated, no exit', async () => {
  const {calls} = installExitStub();
  const mongo = createMongoMock();
  const amqp = createAmqpMock();
  const handler = createBlobHandler(mongo.operator, amqp.operator, emitRecordThenEnd(), {
    nextQueueStatus: NEXT_STATUS
  });

  await handler(BLOB_ID);

  assert.equal(amqp.sendToQueueCalls.length, 1);
  assert.equal(amqp.sendToQueueCalls[0]?.status, NEXT_STATUS);
  const stateUpdates = mongo.updateBlobCalls.filter(
    call => call.payload.op === BLOB_UPDATE_OPERATIONS.updateState
  );
  assert.equal(stateUpdates.length, 1);
  assert.equal(stateUpdates[0]?.payload.state, NEXT_STATUS);
  assert.equal(transformFailureCalls(mongo.updateBlobCalls).length, 0);
  assert.equal(calls.length, 0);
});

test('processHandler throws synchronously: blob marked transformationFailed, no exit', async () => {
  const {calls} = installExitStub();
  const mongo = createMongoMock();
  const amqp = createAmqpMock();
  const handler = createBlobHandler(mongo.operator, amqp.operator, () => {
    throw new Error('Sync throw in user handler');
  }, {nextQueueStatus: NEXT_STATUS});

  await handler(BLOB_ID);

  const failures = transformFailureCalls(mongo.updateBlobCalls);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.id, BLOB_ID);
  assert.ok(typeof failures[0]?.payload.error === 'string');
  assert.ok(String(failures[0]?.payload.error).includes('Sync throw in user handler'));
  assert.equal(calls.length, 0);
});

test('emitter emits error: blob marked transformationFailed, no exit, no propagation', async () => {
  const {calls} = installExitStub();
  const mongo = createMongoMock();
  const amqp = createAmqpMock();
  const processHandler: ProcessHandler = async () => {
    const emitter = new EventEmitter();
    setImmediate(() => {
      emitter.emit('error', new Error('Transform blew up'));
    });
    return emitter;
  };
  const handler = createBlobHandler(mongo.operator, amqp.operator, processHandler, {
    nextQueueStatus: NEXT_STATUS
  });

  // Must resolve (not reject): blob is already marked failed and the loop continues
  await handler(BLOB_ID);
  await tick();

  const failures = transformFailureCalls(mongo.updateBlobCalls);
  assert.equal(failures.length, 2); // error handler + outer catch both call updateBlob
  assert.equal(failures[0]?.id, BLOB_ID);
  assert.ok(String(failures[0]?.payload.error).includes('Transform blew up'));
  assert.equal(calls.length, 0);
});

test('two error events: transformationFailed updates, no exit', async () => {
  const {calls} = installExitStub();
  const mongo = createMongoMock();
  const amqp = createAmqpMock();
  const processHandler: ProcessHandler = async () => {
    const emitter = new EventEmitter();
    setImmediate(() => {
      emitter.emit('error', new Error('First failure'));
      emitter.emit('error', new Error('Second failure'));
    });
    return emitter;
  };
  const handler = createBlobHandler(mongo.operator, amqp.operator, processHandler, {
    nextQueueStatus: NEXT_STATUS
  });

  // Must resolve: errors trigger updateBlob in error handler, then catch block adds one more
  await handler(BLOB_ID);
  await tick();

  const failures = transformFailureCalls(mongo.updateBlobCalls);
  assert.equal(failures.length, 3); // 2 error handler calls + 1 outer catch call
  assert.ok(String(failures[0]?.payload.error).includes('First failure'));
  assert.equal(calls.length, 0);
});

function failedRecordHandler(payloads: RecordPayload[]): ProcessHandler {
  return async () => {
    const emitter = new EventEmitter();
    setImmediate(() => {
      for (const payload of payloads) {
        emitter.emit('record', payload);
      }
      emitter.emit('end');
    });
    return emitter;
  };
}

function getFailedRecordUpdates(calls: MongoMock['updateBlobCalls']) {
  return calls.filter(
    call =>
      call.payload.op === BLOB_UPDATE_OPERATIONS.transformedRecord &&
      call.payload.error !== undefined
  );
}

test('failed record persists full payload (title, standardIdentifiers, message)', async () => {
  const {calls} = installExitStub();
  const mongo = createMongoMock();
  const amqp = createAmqpMock();

  const handler = createBlobHandler(mongo.operator, amqp.operator, failedRecordHandler([
    {
      failed: true,
      title: 'Test Record Title',
      standardIdentifiers: ['978-3-16-148415-0', 'SID:abc123'],
      message: 'Converter failure: invalid field mapping',
      error: null,
      incNumberOfRecords: false,
      record: ''
    }
  ]), {nextQueueStatus: NEXT_STATUS});

  await handler(BLOB_ID);
  await tick();

  const failedUpdates = getFailedRecordUpdates(mongo.updateBlobCalls);
  assert.equal(failedUpdates.length, 1, 'exactly one failed-record update');
  const errorPayload = failedUpdates[0]!.payload.error as Record<string, unknown>;
  assert.equal(errorPayload.title, 'Test Record Title');
  assert.deepStrictEqual(errorPayload.standardIdentifiers, ['978-3-16-148415-0', 'SID:abc123']);
  assert.equal(errorPayload.message, 'Converter failure: invalid field mapping');
  // The destructured restForPayload strips `failed` and `incNumberOfRecords`
  assert.equal(errorPayload.failed, undefined, 'failed flag is stripped');
  assert.equal(errorPayload.incNumberOfRecords, undefined, 'incNumberOfRecords is stripped');
  assert.equal(amqp.sendToQueueCalls.length, 0, 'failed records are not queued');
  assert.equal(calls.length, 0, 'no process.exit');
});

test('failed record with extra fields (messages, record) preserved', async () => {
  const {calls} = installExitStub();
  const mongo = createMongoMock();
  const amqp = createAmqpMock();

  const handler = createBlobHandler(mongo.operator, amqp.operator, failedRecordHandler([
    {
      failed: true,
      title: 'Helmet Record',
      standardIdentifiers: ['ISSN-1234-5678'],
      message: 'Multiple validation errors',
      messages: [
        {description: 'Field 008 is malformed', state: 'invalid'},
        'Secondary error detail'
      ],
      record: {leader: '12345amq22a', fields: []},
      error: null,
      incNumberOfRecords: false
    }
  ]), {nextQueueStatus: NEXT_STATUS});

  await handler(BLOB_ID);
  await tick();

  const failedUpdates = getFailedRecordUpdates(mongo.updateBlobCalls);
  assert.equal(failedUpdates.length, 1, 'exactly one failed-record update');
  const errorPayload = failedUpdates[0]!.payload.error as Record<string, unknown>;
  // Required fields present
  assert.equal(errorPayload.title, 'Helmet Record');
  assert.ok(Array.isArray(errorPayload.standardIdentifiers));
  assert.ok(typeof errorPayload.message === 'string');
  // Optional fields survive
  assert.ok(Array.isArray(errorPayload.messages), 'messages array preserved');
  assert.equal(errorPayload.messages.length, 2, 'messages array length preserved');
  assert.deepStrictEqual(errorPayload.messages[0], {description: 'Field 008 is malformed', state: 'invalid'});
  assert.equal(errorPayload.messages[1], 'Secondary error detail');
  assert.deepStrictEqual(errorPayload.record, {leader: '12345amq22a', fields: []}, 'record object preserved');
  assert.equal(calls.length, 0, 'no process.exit');
});

test('mixed success + failed records: success queued, failed persisted', async () => {
  const {calls} = installExitStub();
  const mongo = createMongoMock();
  const amqp = createAmqpMock();

  const handler = createBlobHandler(mongo.operator, amqp.operator, async () => {
    const emitter = new EventEmitter();
    setImmediate(() => {
      emitter.emit('record', {
        failed: false,
        record: '{"isbn": "978-success"}',
        error: null,
        incNumberOfRecords: true
      });
      emitter.emit('record', {
        failed: true,
        title: 'Failed Record',
        standardIdentifiers: ['ISBN-978-fail'],
        message: 'Parse error on field 245',
        error: null,
        incNumberOfRecords: false,
        record: ''
      });
      emitter.emit('end');
    });
    return emitter;
  }, {nextQueueStatus: NEXT_STATUS});

  await handler(BLOB_ID);
  await tick();

  // Successful record sent to AMQP
  assert.equal(amqp.sendToQueueCalls.length, 1, 'one successful record queued');
  assert.equal(amqp.sendToQueueCalls[0]!.status, NEXT_STATUS);
  assert.deepStrictEqual(amqp.sendToQueueCalls[0]!.data, '{"isbn": "978-success"}');

  // Failed record persisted with full payload
  const failedUpdates = getFailedRecordUpdates(mongo.updateBlobCalls);
  assert.equal(failedUpdates.length, 1, 'exactly one failed-record persisted');
  const errorPayload = failedUpdates[0]!.payload.error as Record<string, unknown>;
  assert.equal(errorPayload.title, 'Failed Record');
  assert.deepStrictEqual(errorPayload.standardIdentifiers, ['ISBN-978-fail']);
  assert.equal(errorPayload.message, 'Parse error on field 245');

  // Both records get a transformedRecord op (success + failure)
  const allTransformed = mongo.updateBlobCalls.filter(
    call => call.payload.op === BLOB_UPDATE_OPERATIONS.transformedRecord
  );
  assert.equal(allTransformed.length, 2, 'two transformedRecord ops (success + failure)');
  assert.equal(calls.length, 0, 'no process.exit');
});

test('failed record without record field (Quria shape) persists without empty object', async () => {
  const {calls} = installExitStub();
  const mongo = createMongoMock();
  const amqp = createAmqpMock();

  const handler = createBlobHandler(mongo.operator, amqp.operator, async () => {
    const emitter = new EventEmitter();
    setImmediate(() => {
      // Quria converter-failure shape: no `record` field at all
      emitter.emit('record', {
        failed: true,
        title: 'Quria Record Without Record Field',
        standardIdentifiers: ['quria:12345'],
        message: 'Converter failure: source format not supported',
        error: null,
        incNumberOfRecords: false
      } as any);
      emitter.emit('end');
    });
    return emitter;
  }, {nextQueueStatus: NEXT_STATUS});

  await handler(BLOB_ID);
  await tick();

  const failedUpdates = getFailedRecordUpdates(mongo.updateBlobCalls);
  assert.equal(failedUpdates.length, 1, 'exactly one failed-record update');
  const errorPayload = failedUpdates[0]!.payload.error as Record<string, unknown>;
  // Required fields present
  assert.equal(errorPayload.title, 'Quria Record Without Record Field');
  assert.deepStrictEqual(errorPayload.standardIdentifiers, ['quria:12345']);
  assert.equal(errorPayload.message, 'Converter failure: source format not supported');
  // No spurious `record` field created
  assert.equal(errorPayload.record, undefined, 'no empty record object created');
  // No extraneous keys beyond what was emitted (title, standardIdentifiers, message, error)
  const expectedKeys = new Set(['title', 'standardIdentifiers', 'message', 'error']);
  const actualKeys = new Set(Object.keys(errorPayload));
  assert.deepStrictEqual([...actualKeys].sort(), [...expectedKeys].sort(), 'only emitted keys present');
  assert.equal(calls.length, 0, 'no process.exit');
});

test('processHandler returns rejected promise: transformationFailed update, no exit', async () => {
  const {calls} = installExitStub();
  const mongo = createMongoMock();
  const amqp = createAmqpMock();
  const processHandler: ProcessHandler = async () => {
    throw new Error('Async transform failure');
  };
  const handler = createBlobHandler(mongo.operator, amqp.operator, processHandler, {
    nextQueueStatus: NEXT_STATUS
  });

  await handler(BLOB_ID);
  await tick();

  const failures = transformFailureCalls(mongo.updateBlobCalls);
  assert.equal(failures.length, 1);
  assert.ok(String(failures[0]?.payload.error).includes('Async transform failure'));
  assert.equal(calls.length, 0);
});
