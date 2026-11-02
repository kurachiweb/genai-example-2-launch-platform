import { AppError } from '../../../lib/core/errors/app-error.ts';

const NOT_FOUND_MESSAGE = '対象が見つかりません。';

export const notFoundError = (): AppError =>
  new AppError({
    kind: 'not_found',
    code: 'not_found',
    message: NOT_FOUND_MESSAGE,
  });
