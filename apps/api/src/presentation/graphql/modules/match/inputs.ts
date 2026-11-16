import { z } from 'zod';

import { UPPERCASE_ULID_PATTERN } from '../../../../../lib/core/ids/uppercase-ulid.ts';
import { MATCH_ERRORS } from '../../../../application/match/match-errors.ts';
import { UPVOTE_HISTORY_PAGE_MAX } from '../../../../application/match/upvote-history-reader.ts';
import { productPageArgsOf } from '../product/inputs.ts';

// 画面の操作では形式の違うIDを送らないため、文言規則どおり存在しないマッチと同じ文言を示す。欄ごとの詳細を1件にするため、ULIDの形式の違反で大文字の検査を止める
export const matchResourceId = z
  .ulid({ error: MATCH_ERRORS.match_not_found.message, abort: true })
  .regex(UPPERCASE_ULID_PATTERN, MATCH_ERRORS.match_not_found.message);

export const UPVOTE_ARGS = z.object({
  input: z.object({
    matchId: matchResourceId,
    entryId: matchResourceId,
  }),
});

export const CANCEL_UPVOTE_ARGS = z.object({
  matchId: matchResourceId,
});

// 件数と位置はローンチ履歴と同じ規則と文言にする。利用者のハンドルの形式の違反は表示できない利用者としてユースケースがnullにする
export const UPVOTE_HISTORY_ARGS = productPageArgsOf(
  UPVOTE_HISTORY_PAGE_MAX,
).extend({ userHandle: z.string() });
