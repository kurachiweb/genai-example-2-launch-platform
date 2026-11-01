import { AppError } from '../../core/errors/app-error.ts';

export const STORAGE_RETRY_AFTER_SECONDS = 5;

export const STORAGE_UNAVAILABLE_MESSAGE =
  '現在ご利用いただけません。しばらく待ってから再度お試しください。';

export function storageUnavailable(): AppError {
  return new AppError({
    kind: 'unavailable',
    code: 'storage_unavailable',
    message: STORAGE_UNAVAILABLE_MESSAGE,
    retryAfterSeconds: STORAGE_RETRY_AFTER_SECONDS,
  });
}

export function isValidLimit(limit: number, max: number): boolean {
  return Number.isInteger(limit) && limit >= 1 && limit <= max;
}

export function invalidLimit(max: number): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'invalid_limit',
    message: `件数は1以上${String(max)}以下の整数で指定してください。`,
  });
}
