import { z } from 'zod';

import {
  commentBodySchema,
  ratingScoreSchema,
} from '../../../../../common-lib/engagement/engagement-rules.ts';
import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';
import { ENGAGEMENT_ERRORS } from '../../../../application/engagement/engagement-errors.ts';

// 他の一覧のカーソルと同じ上限。位置のカーソルはこれより十分に短い
const COMMENT_CURSOR_MAX = 256;

// プロダクト・ローンチ・コメントのIDは26文字の大文字の英数字(ULID)。画面の操作では形式の違うIDを送らないため、存在しない対象と同じ文言を示す
const RESOURCE_ID_PATTERN = /^[0-9A-Z]{26}$/u;

const resourceIdOf = (message: string) =>
  z.string().regex(RESOURCE_ID_PATTERN, message);

const commentTargetId = resourceIdOf(
  ENGAGEMENT_ERRORS.comment_target_not_found.message,
);

const parentCommentId = resourceIdOf(
  ENGAGEMENT_ERRORS.comment_parent_unavailable.message,
);

const ownCommentId = resourceIdOf(ENGAGEMENT_ERRORS.comment_not_found.message);

// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

export const LAUNCH_COMMENTS_ARGS = z.object({
  productId: commentTargetId,
  launchId: commentTargetId,
  after: optional(
    z.string().max(COMMENT_CURSOR_MAX, invalidCursorError().message),
  ),
});

export const LAUNCH_COMMENT_COUNTS_ARGS = z.object({
  productId: commentTargetId,
});

export const POST_COMMENT_ARGS = z.object({
  input: z.object({
    productId: commentTargetId,
    launchId: commentTargetId,
    parentId: optional(parentCommentId),
    body: commentBodySchema,
    rating: optional(ratingScoreSchema),
  }),
});

export const UPDATE_COMMENT_ARGS = z.object({
  input: z.object({
    commentId: ownCommentId,
    body: commentBodySchema,
    rating: optional(ratingScoreSchema),
  }),
});

export const DELETE_COMMENT_ARGS = z.object({
  commentId: ownCommentId,
});
