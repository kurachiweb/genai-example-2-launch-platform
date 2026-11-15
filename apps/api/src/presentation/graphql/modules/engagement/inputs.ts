import { z } from 'zod';

import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';
import { ENGAGEMENT_ERRORS } from '../../../../application/engagement/engagement-errors.ts';

// 他の一覧のカーソルと同じ上限。位置のカーソルはこれより十分に短い
const COMMENT_CURSOR_MAX = 256;

// プロダクトとローンチのIDは26文字の大文字の英数字(ULID)。画面の操作では形式の違うIDを送らないため、存在しない投稿先と同じ文言を示す
const RESOURCE_ID_PATTERN = /^[0-9A-Z]{26}$/u;

const commentTargetId = z
  .string()
  .regex(
    RESOURCE_ID_PATTERN,
    ENGAGEMENT_ERRORS.comment_target_not_found.message,
  );

// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる
export const LAUNCH_COMMENTS_ARGS = z.object({
  productId: commentTargetId,
  launchId: commentTargetId,
  after: z
    .string()
    .max(COMMENT_CURSOR_MAX, invalidCursorError().message)
    .nullish()
    .transform((value) => value ?? undefined),
});

export const LAUNCH_COMMENT_COUNTS_ARGS = z.object({
  productId: commentTargetId,
});
