import { z } from '@hono/zod-openapi';

import {
  MATCH_KINDS,
  MATCH_STAGES,
} from '../../../../../lib/core/match/match-model.ts';
import { ApiImageSchema, UserSummarySchema } from './common.ts';

export const SupporterParamsSchema = z.object({
  handle: z.string().openapi({
    description:
      'プロダクトのハンドル(大文字小文字を区別しない)。保持中の旧ハンドルは現在のハンドルの同じ経路へ302で転送する。',
    example: 'rocketship',
  }),
  match_id: z.string().openapi({
    description: 'マッチのID(ローンチ履歴のmatches[].id)',
    example: '01JD0MTCH00000000000000001',
  }),
});

export const UserHandleParamsSchema = z.object({
  handle: z.string().openapi({
    description:
      '利用者のハンドル(大文字小文字を区別しない)。保持中の旧ハンドルも転送せずにその利用者として扱う。',
    example: 'alice',
  }),
});

export const SupporterSchema = z
  .object({
    user: UserSummarySchema,
    upvoted_at: z.iso.datetime().openapi({ description: 'Upvoteの日時(UTC)' }),
  })
  .openapi('Supporter');

const UpvoteHistoryProductSchema = z
  .object({
    handle: z.string(),
    name: z.string(),
    logo: ApiImageSchema.nullable(),
    listed: z.boolean().openapi({
      description:
        'ディレクトリに掲載中かどうか。未掲載のプロダクトもハンドルを返すが、プロダクトの詳細などの経路では見つからない(404)。',
    }),
  })
  .openapi('UpvoteHistoryProduct');

export const UpvoteHistoryEntrySchema = z
  .object({
    match_id: z.string(),
    kind: z.enum(MATCH_KINDS).openapi({
      description:
        'qualifier(予選マッチ)・week(Weekトーナメント)・year(Yearトーナメント)',
    }),
    round: z.int().nullable().openapi({
      description: 'トーナメントのラウンド。予選マッチはnull',
    }),
    stage: z.enum(MATCH_STAGES).nullable().openapi({
      description:
        'トーナメントの段階。quarterfinal(準々決勝)・semifinal(準決勝)・final(決勝)。予選マッチと段階の名前の無いラウンドはnull',
    }),
    match_date: z.iso.date(),
    live: z.boolean().openapi({
      description: 'Upvoteを受け付けている開催中のマッチかどうか',
    }),
    product: UpvoteHistoryProductSchema.openapi({
      description: 'Upvoteしたマッチの側のプロダクト',
    }),
  })
  .openapi('UpvoteHistoryEntry');

const cursorListMeta = {
  has_next: z.boolean(),
  next_cursor: z.string().nullable(),
};

export const SupporterListSchema = z.object({
  data: z.array(SupporterSchema),
  meta: z.object(cursorListMeta),
});

export const UpvoteHistoryListSchema = z.object({
  data: z.array(UpvoteHistoryEntrySchema),
  meta: z.object({
    total: z.int().min(0).openapi({
      description:
        '取り消し・非公開化・論理削除されたプロダクトと、投稿者が退会済みまたは停止中のプロダクトへのUpvoteを除いた総件数。未掲載のプロダクトへのUpvoteを含む。',
    }),
    ...cursorListMeta,
  }),
});

export type Supporter = z.infer<typeof SupporterSchema>;

export type SupporterList = z.infer<typeof SupporterListSchema>;

export type UpvoteHistoryListEntry = z.infer<typeof UpvoteHistoryEntrySchema>;

export type UpvoteHistoryList = z.infer<typeof UpvoteHistoryListSchema>;
