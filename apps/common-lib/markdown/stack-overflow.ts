const FIREFOX_STACK_OVERFLOW_NAME = 'InternalError';

// V8とJavaScriptCoreはRangeErrorを、Firefoxは標準に無いInternalErrorを投げる
export const isStackOverflowError = (error: unknown): boolean =>
  error instanceof RangeError ||
  (error instanceof Error && error.name === FIREFOX_STACK_OVERFLOW_NAME);
