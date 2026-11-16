import assert from 'node:assert';
import {describe, it} from 'node:test';
import createBlobHandler from '../src/transformer/blobHandler.ts';
import {BLOB_STATE} from '../src/constants.ts';

const mongoOperator = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
const amqpOperator = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
const processHandler = async () => {}; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('createBlobHandler config validation', () => {
  it('returns a handler when nextQueueStatus is a valid BLOB_STATE value', () => {
    const handler = createBlobHandler(mongoOperator, amqpOperator, processHandler, {
      nextQueueStatus: BLOB_STATE.TRANSFORMATION_IN_PROGRESS
    });
    assert.equal(typeof handler, 'function');
  });

  it('throws when nextQueueStatus is omitted', () => {
    assert.throws(
      () => createBlobHandler(mongoOperator, amqpOperator, processHandler, {}),
      /required/
    );
  });

  it('throws when nextQueueStatus is undefined', () => {
    assert.throws(
      () => createBlobHandler(mongoOperator, amqpOperator, processHandler, {nextQueueStatus: undefined}),
      /required/
    );
  });

  it('throws when nextQueueStatus is not a BLOB_STATE value and includes the bad value', () => {
    assert.throws(
      () => createBlobHandler(mongoOperator, amqpOperator, processHandler, {nextQueueStatus: 'TRANSFORMD'} as any),
      /got: TRANSFORMD/
    );
  });
});
