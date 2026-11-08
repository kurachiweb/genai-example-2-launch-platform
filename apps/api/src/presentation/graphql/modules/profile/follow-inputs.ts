import { z } from 'zod';

import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';
import type { FollowListPosition } from '../../../../application/profile/ports.ts';
import { decodeCursor } from '../../pagination.ts';

export const FOLLOW_LIST_MAX_PAGE_SIZE = 20;

// admin・inquiry・paymentsの一覧のカーソルと同じ上限。位置のカーソルはこれより十分に短い
export const FOLLOW_LIST_CURSOR_MAX = 256;

const FIRST_OUT_OF_RANGE_MESSAGE = `表示する件数は1〜${String(FOLLOW_LIST_MAX_PAGE_SIZE)}件の整数で指定してください。`;

// Dateが表せる最大のミリ秒。これを超える時刻は位置として意味を持たない
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;

const ULID_PATTERN = /^[0-9A-Z]{26}$/u;

const FollowListPositionSchema: z.ZodType<FollowListPosition> = z.object({
  t: z.int().min(0).max(MAX_DATE_MILLISECONDS),
  id: z.string().regex(ULID_PATTERN),
});

// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる。空文字列は未指定ではなく不正なカーソルとして扱う
export const FOLLOW_LIST_ARGS = z.object({
  first: z
    .int(FIRST_OUT_OF_RANGE_MESSAGE)
    .min(1, FIRST_OUT_OF_RANGE_MESSAGE)
    .max(FOLLOW_LIST_MAX_PAGE_SIZE, FIRST_OUT_OF_RANGE_MESSAGE),
  after: z
    .string()
    .max(FOLLOW_LIST_CURSOR_MAX, invalidCursorError().message)
    .nullish()
    .transform((value) => value ?? undefined),
});

export function followListPositionOf(
  cursor: string | undefined,
): FollowListPosition | undefined {
  return cursor === undefined
    ? undefined
    : decodeCursor(FollowListPositionSchema, cursor);
}
