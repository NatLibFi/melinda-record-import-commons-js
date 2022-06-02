export const BLOB_STATE = {
  PENDING_TRANSFORMATION: 'PENDING_TRANSFORMATION',
  TRANSFORMATION_IN_PROGRESS: 'TRANSFORMATION_IN_PROGRESS',
  TRANSFORMATION_FAILED: 'TRANSFORMATION_FAILED',
  TRANSFORMED: 'TRANSFORMED',
  PROCESSING: 'PROCESSING',
  PROCESSING_BULK: 'PROCESSING_BULK',
  PROCESSING_PRIO: 'PROCESSING_PRIO',
  PROCESSED: 'PROCESSED',
  ABORTED: 'ABORTED'
};

export const BLOB_UPDATE_OPERATIONS = {
  abort: 'abort',
  addCorrelationId: 'addCorrelationId',
  recordProcessed: 'recordProcessed',
  recordQueued: 'recordQueued',
  transformationFailed: 'transformationFailed',
  transformedRecord: 'transformedRecord',
  updateState: 'updateState'
};

export const RECORD_IMPORT_STATE = {
  CREATED: 'CREATED',
  DUPLICATE: 'DUPLICATE',
  ERROR: 'ERROR',
  INVALID: 'INVALID',
  QUEUED: 'QUEUED',
  SKIPPED: 'SKIPPED',
  UPDATED: 'UPDATED'
};
