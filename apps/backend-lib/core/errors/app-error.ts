export type AppErrorKind =
  | 'bad_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unprocessable'
  | 'rate_limited'
  | 'unavailable';

export type AppErrorStatus =
  400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 503;

export const STATUS_BY_KIND: Readonly<Record<AppErrorKind, AppErrorStatus>> =
  Object.freeze({
    bad_request: 400,
    unauthenticated: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    payload_too_large: 413,
    unsupported_media_type: 415,
    unprocessable: 422,
    rate_limited: 429,
    unavailable: 503,
  });

export interface FieldErrorDetail {
  readonly field: string;
  readonly message: string;
  readonly code: string;
}

export interface AppErrorInit {
  readonly kind: AppErrorKind;
  readonly code: string;
  readonly message: string;
  readonly details?: readonly FieldErrorDetail[];
  readonly retryAfterSeconds?: number;
}

const ERROR_CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

// Retry-Afterは429と503の応答でだけ意味を持つ
const RETRYABLE_KINDS: ReadonlySet<AppErrorKind> = new Set([
  'rate_limited',
  'unavailable',
]);

function assertErrorCode(code: string): void {
  if (!ERROR_CODE_PATTERN.test(code)) {
    throw new RangeError(
      `エラーコードはsnake_caseで指定してください: ${JSON.stringify(code)}`,
    );
  }
}

function assertRetryAfterSeconds(
  kind: AppErrorKind,
  retryAfterSeconds: number | undefined,
): void {
  if (retryAfterSeconds === undefined) {
    return;
  }
  if (!RETRYABLE_KINDS.has(kind)) {
    throw new RangeError(
      `再試行までの秒数はrate_limitedとunavailableにだけ指定できます: ${kind}`,
    );
  }
  // Retry-Afterの秒数(delay-seconds)は0以上の整数だけを表せる
  if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 0) {
    throw new RangeError(
      `再試行までの秒数は0以上の整数で指定してください: ${String(retryAfterSeconds)}`,
    );
  }
}

function freezeDetails(
  details: readonly FieldErrorDetail[] | undefined,
): readonly FieldErrorDetail[] | undefined {
  if (details === undefined) {
    return undefined;
  }
  return Object.freeze(
    details.map(({ field, message, code }) =>
      Object.freeze({ field, message, code }),
    ),
  );
}

export class AppError extends Error {
  override readonly name = 'AppError';
  readonly kind: AppErrorKind;
  readonly code: string;
  readonly details: readonly FieldErrorDetail[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(init: AppErrorInit) {
    assertErrorCode(init.code);
    assertRetryAfterSeconds(init.kind, init.retryAfterSeconds);
    super(init.message);
    this.kind = init.kind;
    this.code = init.code;
    this.details = freezeDetails(init.details);
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}
