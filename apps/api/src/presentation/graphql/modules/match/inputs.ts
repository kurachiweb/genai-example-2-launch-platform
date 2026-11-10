import { z } from 'zod';

import { MATCH_ERRORS } from '../../../../application/match/match-errors.ts';

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
