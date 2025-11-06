export const BLOB_STATE = {
  UPLOADING: 'UPLOADING',
  PENDING_TRANSFORMATION: 'PENDING_TRANSFORMATION',
  TRANSFORMATION_IN_PROGRESS: 'TRANSFORMATION_IN_PROGRESS',
  TRANSFORMATION_FAILED: 'TRANSFORMATION_FAILED',
  PENDING_LOOKUP: 'PENDING_LOOKUP',
  PROCESSING_LOOKUP: 'PROCESSING_LOOKUP',
  TRANSFORMED: 'TRANSFORMED',
  PROCESSING: 'PROCESSING',
  PROCESSING_BULK: 'PROCESSING_BULK',
  PROCESSED: 'PROCESSED',
  COLLECTING: 'COLLECTING',
  PROCESSED_AND_COLLECTED: 'PROCESSED_AND_COLLECTED',
  ABORTED: 'ABORTED'
};

export const BLOB_UPDATE_OPERATIONS = {
  abort: 'abort',
  addCorrelationId: 'addCorrelationId',
  recordProcessed: 'recordProcessed',
  recordQueued: 'recordQueued',
  resetImportResults: 'resetImportResults',
  setCataloger: 'setCataloger',
  setNotificationEmail: 'setNotificationEmail',
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

export const CHUNK_SIZE = 100;
