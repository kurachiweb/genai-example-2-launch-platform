import type { Context, MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import type { Container } from 'inversify';

import type { ApiKeyFeature } from '../../../../common-lib/public-api/api-key-rules.ts';
import { AppError } from '../../../../lib/core/errors/app-error.ts';
import { toErrorResponse } from '../../../../lib/core/errors/error-envelope.ts';
import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import type {
  ApiKeyAuthorizer,
  ApiKeySubject,
  PublicApiCaller,
} from '../../../application/public-api/api-key-authorizer.ts';
import type { PublicApiRateLimitStatus } from '../../../application/public-api/ports.ts';
import { PublicApiRateLimitError } from '../../../application/public-api/public-api-rate-limit-error.ts';
import { PUBLIC_API_TYPES } from '../../../application/public-api/public-api-types.ts';
import type {
  ApiAccess,
  ApiTarget,
} from '../../../domain/public-api/api-key-scopes.ts';
import { parseBearerAuthorization } from '../../../domain/public-api/api-key-token.ts';
import { publicApiError } from './public-api-errors.ts';

export interface PublicApiRouteVariables {
  readonly publicApiCaller: PublicApiCaller;
}

export interface PublicApiAuthEnv {
  readonly Variables: PublicApiRouteVariables & {
    readonly container: Container;
  };
}

type AuthContext = Context<PublicApiAuthEnv>;

const BEARER_CHALLENGE = 'Bearer realm="public-api"';

// RFC 6750の3.1により、提示されたキーが無効な場合だけerrorを添える
const INVALID_TOKEN_CHALLENGE = `${BEARER_CHALLENGE}, error="invalid_token"`;

const MILLISECONDS_PER_SECOND = 1000;

const logger = getAppLogger(['api', 'public-api']);

function rateLimitHeaders(
  status: PublicApiRateLimitStatus,
): Readonly<Record<string, string>> {
  return {
    'X-RateLimit-Limit': String(status.limit),
    'X-RateLimit-Remaining': String(status.remaining),
    'X-RateLimit-Reset': String(
      Math.ceil(status.resetAt / MILLISECONDS_PER_SECOND),
    ),
  };
}

// 名前にkeyを含む属性は伏せ字になるため、キーのIDはrecordIdで記録する
function logRejection(
  c: AuthContext,
  error: AppError,
  subject: ApiKeySubject | undefined,
): void {
  logger.info('公開APIの要求を拒否しました', {
    reason: error.code,
    ...(subject === undefined
      ? {}
      : { recordId: subject.keyId, userId: subject.userId }),
    route: routePath(c),
    status: toErrorResponse(error).status,
  });
}

function respondError(
  c: AuthContext,
  error: AppError,
  extraHeaders: Readonly<Record<string, string>>,
): Response {
  const parts = toErrorResponse(error);
  return c.json(parts.body, parts.status, {
    ...parts.headers,
    ...extraHeaders,
  });
}

// 共通のエラー処理は401のWWW-Authenticateと429のX-RateLimit-*を付けないため、この2つは中間処理が応答を作り、それ以外の拒否は投げ直して共通のエラー処理に任せる
function rejectAuthorization(
  c: AuthContext,
  error: unknown,
  subject: ApiKeySubject | undefined,
): Response {
  if (!(error instanceof AppError)) {
    throw error;
  }
  logRejection(c, error, subject);
  if (error instanceof PublicApiRateLimitError) {
    return respondError(c, error, rateLimitHeaders(error.rateLimit));
  }
  if (error.kind === 'unauthenticated') {
    return respondError(c, error, {
      'WWW-Authenticate': INVALID_TOKEN_CHALLENGE,
    });
  }
  throw error;
}

export function apiKeyAuth(
  feature: ApiKeyFeature,
  access: ApiAccess,
  target: ApiTarget,
): MiddlewareHandler<PublicApiAuthEnv> {
  return async (c, next) => {
    const credentials = parseBearerAuthorization(c.req.header('Authorization'));
    if (credentials.kind !== 'token') {
      const error = publicApiError('unauthenticated');
      logRejection(c, error, undefined);
      return respondError(c, error, { 'WWW-Authenticate': BEARER_CHALLENGE });
    }
    const authorizer = c
      .get('container')
      .get<ApiKeyAuthorizer>(PUBLIC_API_TYPES.ApiKeyAuthorizer);
    const identified: ApiKeySubject[] = [];
    const authorization = await authorizer
      .authorize({
        token: credentials.token,
        feature,
        access,
        target,
        now: new Date(),
        onIdentified: (subject) => identified.push(subject),
      })
      .catch((error: unknown) => rejectAuthorization(c, error, identified[0]));
    if (authorization instanceof Response) {
      return authorization;
    }
    c.set('publicApiCaller', authorization.caller);
    await next();
    // 経路の処理と共通のエラー処理が作った応答のどちらにも、消費した回数を示す
    for (const [name, value] of Object.entries(
      rateLimitHeaders(authorization.rateLimit),
    )) {
      c.header(name, value);
    }
    return undefined;
  };
}
