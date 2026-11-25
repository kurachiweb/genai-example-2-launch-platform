import { z } from 'zod';

import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';
import { decodeCursor } from '../../../../../lib/core/pagination/opaque-cursor.ts';
import {
  type SupporterListPosition,
  SupporterListPositionSchema,
} from '../../../../application/directory/supporter-list-reader.ts';
import { matchResourceId } from '../match/inputs.ts';

export const SUPPORTER_LIST_MAX_PAGE_SIZE = 20;

// 他の一覧のカーソルと同じ上限。位置のカーソルはこれより十分に短い
const SUPPORTER_LIST_CURSOR_MAX = 256;

// 画面の操作では起きない違反のため、文言規則どおりフォロー一覧の件数の文言とマッチが見つからない文言を使う
const FIRST_OUT_OF_RANGE_MESSAGE = `表示する件数は1〜${String(SUPPORTER_LIST_MAX_PAGE_SIZE)}件の整数で指定してください。`;

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
