import {
  type AppError,
  type AppErrorStatus,
  type FieldErrorDetail,
  STATUS_BY_KIND,
} from './app-error.ts';

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly FieldErrorDetail[];
  };
}

export interface ErrorResponseParts {
  readonly status: AppErrorStatus | 500;
  readonly body: ErrorEnvelope;
  readonly headers: Readonly<Record<string, string>>;
}

const NO_STORE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store',
});

function createEnvelope(
  code: string,
  message: string,
  details?: readonly FieldErrorDetail[],
): ErrorEnvelope {
  const error =
    details === undefined ? { code, message } : { code, message, details };
  return Object.freeze({ error: Object.freeze(error) });
}

function createHeaders(
  retryAfterSeconds: number | undefined,
): Readonly<Record<string, string>> {
  if (retryAfterSeconds === undefined) {
    return NO_STORE_HEADERS;
  }
  return Object.freeze({
    ...NO_STORE_HEADERS,
    'Retry-After': String(retryAfterSeconds),
  });
}

export function toErrorResponse(error: AppError): ErrorResponseParts {
  return Object.freeze({
    status: STATUS_BY_KIND[error.kind],
    body: createEnvelope(error.code, error.message, error.details),
    headers: createHeaders(error.retryAfterSeconds),
  });
}

export const INTERNAL_ERROR_RESPONSE: ErrorResponseParts = Object.freeze({
  status: 500,
  body: createEnvelope(
    'internal_error',
    '問題が発生しました。時間をおいて再度お試しください。',
  ),
  headers: NO_STORE_HEADERS,
});

export const NOT_FOUND_RESPONSE: ErrorResponseParts = Object.freeze({
  status: 404,
  body: createEnvelope('not_found', 'お探しの内容は見つかりませんでした。'),
  headers: NO_STORE_HEADERS,
});
