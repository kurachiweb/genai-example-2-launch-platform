import { AppError } from '../../core/errors/app-error.ts';
import {
  MEDIA_RETRY_AFTER_SECONDS,
  MEDIA_UNAVAILABLE_MESSAGE,
} from '../../core/media/media-unavailable.ts';

export function storageUnavailable(): AppError {
  return new AppError({
    kind: 'unavailable',
    code: 'storage_unavailable',
    message: MEDIA_UNAVAILABLE_MESSAGE,
    retryAfterSeconds: MEDIA_RETRY_AFTER_SECONDS,
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
