import { z } from 'zod';

import { MATCH_ERRORS } from '../../../../application/match/match-errors.ts';
import { UPVOTE_HISTORY_PAGE_MAX } from '../../../../application/match/upvote-history-reader.ts';
import { productPageArgsOf } from '../product/inputs.ts';

// 画面の操作では形式の違うIDを送らないため、文言規則どおり存在しないマッチと同じ文言を示す
const matchResourceId = z.ulid(MATCH_ERRORS.match_not_found.message);

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
