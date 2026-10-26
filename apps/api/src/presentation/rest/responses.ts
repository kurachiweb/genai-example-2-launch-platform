import { z } from '@hono/zod-openapi';

import type { AppErrorStatus } from '../../../lib/core/errors/app-error.ts';
import type { ErrorEnvelope } from '../../../lib/core/errors/error-envelope.ts';

export type ErrorStatus = AppErrorStatus;

export const ERROR_STATUSES: readonly ErrorStatus[] = Object.freeze([
  400, 401, 403, 404, 409, 422, 429, 503,
]);

const ERROR_DESCRIPTIONS: Readonly<Record<ErrorStatus, string>> = Object.freeze(
  {
    400: '入力内容が正しくありません。',
    401: '認証されていません。',
    403: '操作する権限がありません。',
    404: '対象が見つかりません。',
    409: '対象の状態と競合しています。',
    422: '入力内容を処理できません。',
    429: '要求の回数が上限を超えました。',
    503: '一時的に利用できません。',
  },
);

const fieldErrorDetailSchema = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string(),
});

export const ErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.array(fieldErrorDetailSchema).optional(),
    }),
  })
  .openapi('ErrorEnvelope') satisfies z.ZodType<ErrorEnvelope>;

export interface ErrorResponseConfig {
  readonly description: string;
  readonly content: {
    readonly 'application/json': {
      readonly schema: typeof ErrorEnvelopeSchema;
    };
  };
}

export type ErrorResponses<S extends ErrorStatus> = {
  readonly [K in `${S}`]: ErrorResponseConfig;
};

export function dataEnvelope<T extends z.ZodType>(item: T) {
  return z.object({ data: item });
}

export function offsetListEnvelope<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    meta: z.object({
      total: z.int().min(0),
      page: z.int().min(1),
      per_page: z.int().min(1),
      total_pages: z.int().min(0),
    }),
  });
}

export function cursorListEnvelope<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    meta: z.object({
      has_next: z.boolean(),
      next_cursor: z.string().nullable(),
    }),
  });
}

export function errorResponses<S extends ErrorStatus>(
  statuses: readonly S[],
): ErrorResponses<S> {
  return Object.fromEntries(
    statuses.map((status) => [
      String(status),
      {
        description: ERROR_DESCRIPTIONS[status],
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
    ]),
  ) as ErrorResponses<S>;
}
