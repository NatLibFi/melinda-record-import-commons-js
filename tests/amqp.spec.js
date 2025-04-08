import {expect} from 'chai';
import {READERS} from '@natlibfi/fixura';
import generateTests from '@natlibfi/fixugen';
import * as fakeAmqpLib from '@onify/fake-amqplib';
import {createAmqpOperator} from '../src/amqp.js';

run();

async function run() {
  const amqpOperator = await createAmqpOperator(fakeAmqpLib, 'amqp://example.com');
  const blobId = 'test-queue-aaa-111-bbb';
  const status = 'PENDING_TEST';

  generateTests({
    callback,
    path: [__dirname, '..', 'test-fixtures', 'amqp'],
    recurse: false,
    useMetadataFile: true,
    fixura: {
      failWhenNotFound: true,
      reader: READERS.JSON
    },
    mocha: {
      beforeEach: async () => {
        const count = await amqpOperator.countQueue({blobId, status});
        if (count > 0) {
          throw new Error('TEST QUEUE CONTAMINATION! ', count);
        }
      },
      afterEach: async () => {
        await amqpOperator.purgeQueue({blobId, status});
        await amqpOperator.deleteQueue({blobId, status}, true);
      },
      after: () => {
        fakeAmqpLib.resetMock();
      }
    }
  });

  async function callback({
    getFixture,
    operationParams = {
      queueRecords: 10,
      operations: []
    },
    expectedToFail = false,
    expectedErrorStatus = 200,
    expectedErrorMessage = ''
  }) {
    try {
      const prepared = await prepareQueues({blobId, status, ...operationParams});
      const operationsDone = await runOperations({blobId, status, ...operationParams});
      //console.log(operationsDone); // eslint-disable-line

      const count = await amqpOperator.countQueue({blobId, status, ...operationParams});

      const expectedResult = await getFixture('expectedResult.json');
      expect({prepared, operationsDone, count}).to.eql(expectedResult);
    } catch (error) {
      if (!expectedToFail) {
        throw error;
      }

      // console.log(error); // eslint-disable-line
      expect(error.status).to.eql(expectedErrorStatus);
      expect(error.payload).to.eql(expectedErrorMessage);
      expect(expectedToFail).to.eql(true, 'This test is not suppose to fail!');
    }

    async function prepareQueues({queueRecords}) {
      if (queueRecords === false || queueRecords === 0) {
        return queueRecords;
      }

      const records = prepareRecords(queueRecords);
      await sendRecordsToQueue(records);
      // const count = await amqpOperator.countQueue({blobId, status});
      // console.log(`${count} records prepared for test`); // eslint-disable-line

      return queueRecords;
    }

    async function sendRecordsToQueue(records) {
      const [record, ...rest] = records;
      if (record === undefined) {
        return;
      }

      await amqpOperator.sendToQueue({blobId, status, headers: {test: true}, data: record});
      return sendRecordsToQueue(rest);
    }

    async function runOperations({blobId, status, operations = [], operationsDone = []}) {
      const [operation, ...rest] = operations;

      if (operation === undefined) {
        return operationsDone;
      }

      if (operation === 'purge') {
        await amqpOperator.purgeQueue({blobId, status});
        return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, operation]});
      }

      if (operation === 'sendToQueue') {
        const [record] = prepareRecords(1);
        await amqpOperator.sendToQueue({blobId, status, data: record});
        return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, operation]});
      }

      if (operation === 'getOne') {
        const result = await amqpOperator.getOne({blobId, status});
        const count = await amqpOperator.countQueue({blobId, status});

        if (count > 0) {
          //console.log(result);
          expect(result.records).to.have.lengthOf(1);
          expect(result.messages).to.have.lengthOf(1);

          return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, `${operation}: OK`]});
        }
        // console.log(result);

        expect(result).to.eql(false);
        return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, `${operation}: FALSE`]});
      }

      if (operation === 'getOneAndAck') {
        const result = await amqpOperator.getOne({blobId, status});
        const count = await amqpOperator.countQueue({blobId, status});
        //console.log(result);

        if (count === 0) {
          expect(result).to.eql(false);
          return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, `${operation}: FALSE`]});
        }

        //console.log(result);
        expect(result.records).to.have.lengthOf(1);
        expect(result.messages).to.have.lengthOf(1);
        await amqpOperator.ackMessages(result.messages);

        return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, `${operation}: OK`]});
      }

      if (operation === 'getChunk') {
        const result = await amqpOperator.getChunk({blobId, status});
        const count = await amqpOperator.countQueue({blobId, status});

        if (count > 0) {
          //console.log(result);
          expect(result.records).to.have.lengthOf(count <= 100 ? count : 100);
          expect(result.messages).to.have.lengthOf(count <= 100 ? count : 100);

          return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, `${operation}: OK`]});
        }
        // console.log(result);

        expect(result).to.eql(false);
        return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, `${operation}: FALSE`]});
      }

      if (operation === 'getChunkAndAck') {
        const result = await amqpOperator.getChunk({blobId, status});
        const count = await amqpOperator.countQueue({blobId, status});

        if (count > 0) {
          //console.log(result);
          expect(result.records).to.have.lengthOf(count <= 100 ? count : 100);
          expect(result.messages).to.have.lengthOf(count <= 100 ? count : 100);
          await amqpOperator.ackMessages(result.messages);

          return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, `${operation}: OK`]});
        }
        // console.log(result);

        expect(result).to.eql(false);
        return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, `${operation}: FALSE`]});
      }

      if (operation === 'getChunkAndNack') {
        const result = await amqpOperator.getChunk({blobId, status});
        const count = await amqpOperator.countQueue({blobId, status});

        if (count > 0) {
          //console.log(result);
          expect(result.records).to.have.lengthOf(count <= 100 ? count : 100);
          expect(result.messages).to.have.lengthOf(count <= 100 ? count : 100);
          await amqpOperator.nackMessages(result.messages);

          return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, `${operation}: OK`]});
        }
        // console.log(result);

        expect(result).to.eql(false);
        return runOperations({blobId, status, operations: rest, operationsDone: [...operationsDone, `${operation}: FALSE`]});
      }
    }

    function prepareRecords(amount) {
      return new Array(amount)
        .fill({})
        .map((obj, index) => ({'leader': '02518cam a2200745zi 4500', 'fields': [{'tag': '001', 'value': `${index + 1}`.padStart(9, '0')}]}));
    }
  }
}
