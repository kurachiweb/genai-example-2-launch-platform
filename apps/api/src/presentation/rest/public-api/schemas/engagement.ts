import { z } from '@hono/zod-openapi';

import { COMMENT_MAX_DEPTH } from '../../../../../common-lib/engagement/engagement-rules.ts';
import { cursorListEnvelope } from '../../responses.ts';
import { UserSummarySchema } from './common.ts';
import { ProductHandleParamsSchema } from './products.ts';

export const LaunchCommentParamsSchema = ProductHandleParamsSchema.extend({
  launch_id: z.string().openapi({
    description: 'ローンチのID(ローンチ履歴のid)',
    example: '01JD0LNCH00000000000000001',
  }),
});

const commentNodeShape = {
  id: z.string(),
  parent_id: z.string().nullable().openapi({
    description:
      '返信先のコメントのID。トップレベルはnull。置き換え表示でも返し、返信のツリー構造を保つ',
  }),
  depth: z
    .int()
    .min(1)
    .max(COMMENT_MAX_DEPTH)
    .openapi({
      description: `階層。トップレベルは1、返信は2〜${String(COMMENT_MAX_DEPTH)}`,
    }),
  removed: z.boolean().openapi({
    description:
      '削除・非公開化されたコメントと、退会済み・停止中の利用者のコメントの置き換え表示かどうか。真なら投稿者・本文・日時をnull、editedを偽で返す。',
  }),
  author: UserSummarySchema.nullable().openapi({
    description:
      '投稿者。置き換え表示と、読み取りの後に投稿者を表示できなくなったコメントはnull',
  }),
  body_markdown: z.string().nullable().openapi({
    description: '本文(マークダウン)。置き換え表示はnull',
  }),
  created_at: z.iso.datetime().nullable().openapi({
    description: '投稿の日時(UTC)。置き換え表示はnull',
  }),
  edited: z.boolean().openapi({ description: '編集済みかどうか' }),
};

export const CommentNodeSchema = z
  .object(commentNodeShape)
  .openapi('CommentNode');

export const CommentThreadSchema = z
  .object({
    ...commentNodeShape,
    replies: z.array(CommentNodeSchema).openapi({
      description:
        'トップレベルへの返信(返信への返信を含む)を投稿の古い順に並べたもの',
    }),
  })
  .openapi('CommentThread');

export const CommentListSchema = cursorListEnvelope(CommentThreadSchema);

export const RatingSummarySchema = z
  .object({
    average: z.number().min(1).max(5).nullable().openapi({
      description: '5段階評価の丸めない平均値。有効な評価が無ければnull',
    }),
    count: z.int().min(0).openapi({ description: '有効な評価の件数' }),
  })
  .openapi('RatingSummary');

export type CommentNode = z.infer<typeof CommentNodeSchema>;

export type CommentThread = z.infer<typeof CommentThreadSchema>;

export type CommentList = z.infer<typeof CommentListSchema>;

export type RatingSummary = z.infer<typeof RatingSummarySchema>;
