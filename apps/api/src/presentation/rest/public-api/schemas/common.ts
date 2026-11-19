import { z } from '@hono/zod-openapi';

import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';

export const PUBLIC_API_CURSOR_MAX = 256;

export const ApiImageSchema = z
  .object({
    url: z.url(),
    width: z.int().nullable(),
    height: z.int().nullable(),
  })
  .openapi('Image', {
    description:
      '画像。隔離中・削除待ちなど配信できない画像は、この値の代わりにnullを返す。',
  });

export const UserSummarySchema = z
  .object({
    handle: z.string(),
    nickname: z.string(),
    avatar: ApiImageSchema.nullable(),
    profile_url: z.url(),
  })
  .openapi('UserSummary');

// 問い合わせの検証で拒否するとvalidation_errorになるため、空・長すぎる値も他の形式違反と同じinvalid_cursorにするよう、判定はpublicApiCursorOfに任せる
export const CursorQuerySchema = z.object({
  cursor: z
    .string()
    .optional()
    .openapi({
      description: `続きの位置。前のページの応答のmeta.next_cursorをそのまま指定し、省略すると最初のページを返す。空の値・${String(PUBLIC_API_CURSOR_MAX)}文字を超える値・形式に合わない値は400(invalid_cursor)になる。`,
    }),
});

// 上流の読み取りへ渡す経路と自分で復号する経路のどちらも、渡す前にこの判定を通す
export function publicApiCursorOf(
  cursor: string | undefined,
): string | undefined {
  if (
    cursor !== undefined &&
    (cursor.length === 0 || cursor.length > PUBLIC_API_CURSOR_MAX)
  ) {
    throw invalidCursorError();
  }
  return cursor;
}

export type ApiImage = z.infer<typeof ApiImageSchema>;

export type UserSummary = z.infer<typeof UserSummarySchema>;
