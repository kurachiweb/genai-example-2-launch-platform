import { z } from 'zod';

import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';
import type { SupporterListPosition } from '../../../../application/directory/supporter-list-reader.ts';
import { MATCH_ERRORS } from '../../../../application/match/match-errors.ts';
import { decodeCursor } from '../../pagination.ts';

export const SUPPORTER_LIST_MAX_PAGE_SIZE = 20;

// 他の一覧のカーソルと同じ上限。位置のカーソルはこれより十分に短い
const SUPPORTER_LIST_CURSOR_MAX = 256;

// 画面の操作では起きない違反のため、文言規則どおりフォロー一覧の件数の文言とマッチが見つからない文言を使う
const FIRST_OUT_OF_RANGE_MESSAGE = `表示する件数は1〜${String(SUPPORTER_LIST_MAX_PAGE_SIZE)}件の整数で指定してください。`;

const matchResourceId = z.ulid(MATCH_ERRORS.match_not_found.message);

// Dateが表せる最大のミリ秒。これを超える時刻は位置として意味を持たない
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;

const ULID_PATTERN = /^[0-9A-Z]{26}$/u;

const SupporterListPositionSchema: z.ZodType<SupporterListPosition> = z.object({
  upvotedAt: z.int().min(0).max(MAX_DATE_MILLISECONDS),
  upvoteId: z.string().regex(ULID_PATTERN),
});

// プロダクトのハンドルの形式の違反は表示できないプロダクトとしてユースケースがnullにする。GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる
export const MATCH_SUPPORTERS_ARGS = z.object({
  productHandle: z.string(),
  matchId: matchResourceId,
  entryId: matchResourceId,
  first: z
    .int(FIRST_OUT_OF_RANGE_MESSAGE)
    .min(1, FIRST_OUT_OF_RANGE_MESSAGE)
    .max(SUPPORTER_LIST_MAX_PAGE_SIZE, FIRST_OUT_OF_RANGE_MESSAGE),
  after: z
    .string()
    .max(SUPPORTER_LIST_CURSOR_MAX, invalidCursorError().message)
    .nullish()
    .transform((value) => value ?? undefined),
});

export function supporterListPositionOf(
  cursor: string | undefined,
): SupporterListPosition | undefined {
  return cursor === undefined
    ? undefined
    : decodeCursor(SupporterListPositionSchema, cursor);
}
