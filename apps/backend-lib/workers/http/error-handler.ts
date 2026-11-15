import type { Context, ErrorHandler, NotFoundHandler } from 'hono';

import { AppError } from '../../core/errors/app-error.ts';
import {
  type ErrorResponseParts,
  INTERNAL_ERROR_RESPONSE,
  NOT_FOUND_RESPONSE,
  toErrorResponse,
} from '../../core/errors/error-envelope.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

function respond(c: Context, parts: ErrorResponseParts): Response {
  return c.json(parts.body, parts.status, parts.headers);
}

export function createErrorHandler(
  appName: LoggingOptions['appName'],
): ErrorHandler {
  const logger = getAppLogger([appName, 'http', 'error']);
  return (error, c) => {
    if (error instanceof AppError) {
      return respond(c, toErrorResponse(error));
    }
    logger.error('想定外の例外が発生しました', { error });
    return respond(c, INTERNAL_ERROR_RESPONSE);
  };
}

export const handleNotFound: NotFoundHandler = (c) =>
  respond(c, NOT_FOUND_RESPONSE);
