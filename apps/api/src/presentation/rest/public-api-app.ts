import { OpenAPIHono, type z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';

import {
  AppError,
  type FieldErrorDetail,
} from '../../../lib/core/errors/app-error.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';

export const PUBLIC_API_BASE_PATH = '/v1';

export const OPENAPI_DOCUMENT_PATH = '/openapi.json';

export const API_KEY_SECURITY_SCHEME = 'ApiKeyAuth';

// 経路の定義のsecurityは変更可能な配列の型を求めるため、スコープは空のタプルの型で表す
export const API_KEY_SECURITY: readonly [
  { readonly [API_KEY_SECURITY_SCHEME]: [] },
] = Object.freeze([
  Object.freeze({ [API_KEY_SECURITY_SCHEME]: Object.freeze([]) as [] }),
] as const);

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

export type PublicApiApp<E extends PlatformEnv> = OpenAPIHono<
  PlatformHonoEnv<E>
>;

export type PublicRestRoutes<E extends PlatformEnv> = (
  api: PublicApiApp<E>,
) => void;

function toFieldErrorDetails(
  issues: readonly z.core.$ZodIssue[],
): FieldErrorDetail[] {
  return issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

function createValidationError(issues: readonly z.core.$ZodIssue[]): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: toFieldErrorDetails(issues),
  });
}

const MALFORMED_BODY_STATUS = 400;
const UNSUPPORTED_MEDIA_TYPE_STATUS = 415;

function createMalformedBodyError(): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [
      {
        field: '',
        code: 'invalid_json',
        message: '本文をJSONとして解析できません。',
      },
    ],
  });
}

// AppErrorの種類に415が無いため、本文の形式の不一致も入力の誤りとして400で返す
function createUnsupportedMediaTypeError(): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'unsupported_media_type',
    message: 'Content-Typeにapplication/jsonを指定してください。',
  });
}

// 検証の部品は本文の解析の失敗と形式の不一致をHTTPExceptionで投げ、基盤のエラー処理はそれを想定外の例外として扱うため、AppErrorへ変える
function toPublicApiError(error: Error): Error {
  if (!(error instanceof HTTPException)) {
    return error;
  }
  if (error.status === MALFORMED_BODY_STATUS) {
    return createMalformedBodyError();
  }
  if (error.status === UNSUPPORTED_MEDIA_TYPE_STATUS) {
    return createUnsupportedMediaTypeError();
  }
  return error;
}

export function createPublicApiApp<E extends PlatformEnv>(): PublicApiApp<E> {
  const api = new OpenAPIHono<PlatformHonoEnv<E>>({
    // 例外にすることで、基盤のエラー処理が他の想定内の失敗と同じ共通のエラー形式で応答する
    defaultHook: (result) => {
      if (!result.success) {
        throw createValidationError(result.error.issues);
      }
    },
  });
  // 応答を返さず再送出し、外側のミドルウェア(エラートラッキング)が見る例外もAppErrorにする
  api.onError((error) => {
    throw toPublicApiError(error);
  });
  return api;
}

export function registerApiKeySecurityScheme<E extends PlatformEnv>(
  api: PublicApiApp<E>,
): void {
  api.openAPIRegistry.registerComponent(
    'securitySchemes',
    API_KEY_SECURITY_SCHEME,
    { type: 'http', scheme: 'bearer' },
  );
}
