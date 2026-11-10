declare module 'http-status' {
  const httpStatus: {
    [key: number]: number;
    [key: string]: string | number | undefined;
    BAD_REQUEST: number;
    OK: number;
    CREATED: number;
    NO_CONTENT: number;
    UNPROCESSABLE_ENTITY: number;
  };

  export default httpStatus;
}

declare module './constants.js' {
  export const BLOB_UPDATE_OPERATIONS: {
    abort: string;
    addCorrelationId: string;
    recordProcessed: string;
    recordQueued: string;
    resetImportResults: string;
    setCataloger: string;
    setNotificationEmail: string;
    transformationFailed: string;
    transformedRecord: string;
    updateState: string;
  };
}
