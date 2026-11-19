import { z } from '@hono/zod-openapi';

import {
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_SEARCH_MAX_GRAPHEMES,
  DIRECTORY_SORTS,
} from '../../../../../common-lib/directory/directory-query-rules.ts';
import { isBusinessDateString } from '../../../../../common-lib/directory/directory-period.ts';
import { checkHandleFormat } from '../../../../../common-lib/handles/handle-rules.ts';
import { PRODUCT_CATEGORY_HANDLE_RULE } from '../../../../../common-lib/product/product-input-rules.ts';
import { countGraphemes } from '../../../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import {
  ENTRY_RESULTS,
  MATCH_DECISIONS,
  MATCH_KINDS,
  MATCH_STAGES,
} from '../../../../../lib/core/match/match-model.ts';
import { ApiImageSchema, UserSummarySchema } from './common.ts';

// 取消のローンチはローンチ履歴に含めない
export const PUBLIC_LAUNCH_STATUSES = Object.freeze([
  'scheduled',
  'paired',
  'in_progress',
  'finished',
] as const);

// ページの位置の計算(ページ番号から1を引いて1ページの件数を掛けた値)が安全な整数に収まる上限
export const PRODUCT_LIST_PAGE_MAX = Math.floor(
  Number.MAX_SAFE_INTEGER / DIRECTORY_PAGE_SIZE,
);

export const PRODUCT_LIST_QUERY_MESSAGES = Object.freeze({
  qRequired: '検索キーワードを入力してください。',
  qTooLong: `検索キーワードは${String(DIRECTORY_SEARCH_MAX_GRAPHEMES)}文字以内で入力してください。`,
  categoryNotFound: 'カテゴリが見つかりません。',
  invalidDate: '日付はYYYY-MM-DDの形式の実在する日付で指定してください。',
  reversedPeriod: '開始日は終了日以前の日付を選んでください。',
  invalidSort: `並び順は${DIRECTORY_SORTS.join('・')}のいずれかで指定してください。`,
  relevanceWithoutQ:
    '関連度の並び順は検索キーワードと合わせて指定してください。',
  invalidPage: 'ページ番号は1以上の整数で指定してください。',
});

const PAGE_NUMBER_PATTERN = /^[1-9]\d*$/u;

const businessDateQuery = (description: string) =>
  z
    .string()
    .refine(isBusinessDateString, PRODUCT_LIST_QUERY_MESSAGES.invalidDate)
    .optional()
    .openapi({ description, example: '2026-11-05' });

// 上流のディレクトリの読み取りは不正な値を黙って既定値に戻すため、公開APIは渡す前に検証して入力の誤りにする
export const ProductListQuerySchema = z
  .object({
    q: z
      .string()
      .superRefine((value, context) => {
        const graphemes = countGraphemes(trimWhiteSpace(value));
        if (graphemes === 0) {
          context.addIssue({
            code: 'custom',
            message: PRODUCT_LIST_QUERY_MESSAGES.qRequired,
          });
        } else if (graphemes > DIRECTORY_SEARCH_MAX_GRAPHEMES) {
          context.addIssue({
            code: 'custom',
            message: PRODUCT_LIST_QUERY_MESSAGES.qTooLong,
          });
        }
      })
      .optional()
      .openapi({
        description: `検索キーワード。前後の空白を除いて1〜${String(DIRECTORY_SEARCH_MAX_GRAPHEMES)}文字。`,
      }),
    category: z
      .string()
      .refine(
        (value) =>
          checkHandleFormat(value, PRODUCT_CATEGORY_HANDLE_RULE) === 'ok',
        PRODUCT_LIST_QUERY_MESSAGES.categoryNotFound,
      )
      .optional()
      .openapi({
        description:
          'プロダクトカテゴリのハンドル(大文字小文字を区別しない)。存在しないカテゴリは400になる。',
      }),
    from: businessDateQuery(
      '基準勝利のローンチ日の期間の開始日(基準時刻の日付、YYYY-MM-DD)。',
    ),
    to: businessDateQuery(
      '基準勝利のローンチ日の期間の終了日(基準時刻の日付、YYYY-MM-DD)。開始日以後の日付にする。',
    ),
    sort: z
      .enum(DIRECTORY_SORTS, PRODUCT_LIST_QUERY_MESSAGES.invalidSort)
      .optional()
      .openapi({
        description:
          '並び順。relevance(関連度、検索キーワードがあるときだけ)・newest(基準勝利の新しい順)・oldest(基準勝利の古い順)・upvotes(基準勝利のUpvote数の多い順)。省略すると検索キーワードがあればrelevance、無ければnewest。',
      }),
    page: z
      .string()
      .refine(
        (value) =>
          PAGE_NUMBER_PATTERN.test(value) &&
          Number(value) <= PRODUCT_LIST_PAGE_MAX,
        PRODUCT_LIST_QUERY_MESSAGES.invalidPage,
      )
      .optional()
      .openapi({
        description: `ページ番号(1〜${String(PRODUCT_LIST_PAGE_MAX)}の整数、1ページ${String(DIRECTORY_PAGE_SIZE)}件)。省略すると1。総ページ数を超えるページは空の一覧を返す。`,
      }),
  })
  .superRefine((query, context) => {
    if (
      query.from !== undefined &&
      query.to !== undefined &&
      query.from > query.to
    ) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: PRODUCT_LIST_QUERY_MESSAGES.reversedPeriod,
      });
    }
    if (query.sort === 'relevance' && query.q === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['sort'],
        message: PRODUCT_LIST_QUERY_MESSAGES.relevanceWithoutQ,
      });
    }
  });

export const ProductHandleParamsSchema = z.object({
  handle: z.string().openapi({
    description:
      'プロダクトのハンドル(大文字小文字を区別しない)。保持中の旧ハンドルは現在のハンドルの同じ経路へ302で転送する。',
    example: 'rocketship',
  }),
});

export const ProductCategorySchema = z
  .object({
    handle: z.string(),
    name: z.string(),
  })
  .openapi('ProductCategory');

const AwardSchema = z
  .object({
    kind: z.enum(['week', 'year']).openapi({
      description: 'week(Weekトーナメントの優勝)・year(Yearトーナメントの優勝)',
    }),
    count: z.int().min(1),
  })
  .openapi('ProductAward');

const BaseWinSchema = z
  .object({
    launch_date: z.iso.date(),
    kind: z.enum(['victory', 'bye', 'early']).openapi({
      description:
        'victory(勝利)・bye(不戦勝)・early(相手の該当による早期の不戦勝)',
    }),
    upvote_count: z.int().min(0).nullable().openapi({
      description: '対戦相手のいない不戦勝はnull',
    }),
  })
  .openapi('ProductBaseWin', {
    description: '予選マッチの最初の勝利(ディレクトリへの掲載の根拠)',
  });

const productFields = {
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  tagline: z.string(),
  category: ProductCategorySchema,
  website_url: z.string().openapi({
    description:
      '外部WebサイトのURL。現在の検証の規則に通らない値は空文字列にする。',
  }),
  logo: ApiImageSchema.nullable(),
  owner: UserSummarySchema.nullable().openapi({
    description: '投稿者。表示できない投稿者はnull',
  }),
  awards: z.array(AwardSchema).openapi({ description: 'Yearを先頭にする' }),
  page_url: z.url().openapi({ description: 'プロダクト詳細ページのURL' }),
};

export const ProductListItemSchema = z
  .object({ ...productFields, base_win: BaseWinSchema })
  .openapi('ProductListItem');

export const ProductDetailSchema = z
  .object({
    ...productFields,
    description_markdown: z.string(),
    screenshots: z.array(ApiImageSchema.nullable()).openapi({
      description: '表示順。配信できない画像はnull',
    }),
    first_launch_date: z.iso.date().nullable().openapi({
      description: 'キックオフした最初のローンチのローンチ日',
    }),
    launch_count: z.int().min(0).openapi({
      description: 'キックオフしたローンチの回数',
    }),
    record: z.object({
      wins: z.int().min(0),
      losses: z.int().min(0),
    }),
  })
  .openapi('ProductDetail');

const OpponentSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('private') }),
    z.object({ kind: z.literal('unlisted'), name: z.string() }),
    z.object({
      kind: z.literal('listed'),
      handle: z.string(),
      name: z.string(),
    }),
  ])
  .openapi('LaunchMatchOpponent', {
    description:
      '対戦相手。none(相手のいないマッチ)・private(非公開のプロダクト、または不戦勝の相手)・unlisted(可視だが未掲載、名称だけ)・listed(掲載中、ハンドルと名称)',
  });

const LaunchMatchSchema = z
  .object({
    id: z.string(),
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
    result: z.enum(ENTRY_RESULTS).openapi({
      description:
        'このプロダクトの側の結果。won(勝利)・lost(敗北)・bye(不戦勝)・walkover(相手の該当による不戦勝)',
    }),
    decision: z.enum(MATCH_DECISIONS).openapi({
      description:
        '決着の方法。votes(Upvote数)・last_upvote(同数での最後のUpvoteの時刻)・no_votes(両者0票の両者敗北)・bye(相手のいない不戦勝)・walkover(相手の該当による不戦勝)・both_forfeited(両方の側の該当による両者敗北)',
    }),
    ended_early: z.boolean(),
    upvote_count: z.int().min(0),
    opponent_upvote_count: z.int().min(0).nullable().openapi({
      description: '不戦勝と相手のいないマッチはnull',
    }),
    opponent: OpponentSchema,
  })
  .openapi('LaunchMatch');

export const LaunchSchema = z
  .object({
    id: z.string(),
    number: z.int().min(1).openapi({ description: '第◯回' }),
    launch_date: z.iso.date(),
    status: z.enum(PUBLIC_LAUNCH_STATUSES).openapi({
      description:
        'scheduled(キックオフ予定)・paired(組み合わせ決定済み)・in_progress(予選マッチ中)・finished(終了)',
    }),
    summary: z.string().openapi({ description: '結果の要約(表示用の文言)' }),
    matches: z.array(LaunchMatchSchema).openapi({
      description: '結果が確定したマッチを実施日の新しい順に',
    }),
  })
  .openapi('Launch');

export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

export type ProductCategory = z.infer<typeof ProductCategorySchema>;

export type ProductListItem = z.infer<typeof ProductListItemSchema>;

export type ProductDetail = z.infer<typeof ProductDetailSchema>;

export type Launch = z.infer<typeof LaunchSchema>;

export type LaunchMatch = z.infer<typeof LaunchMatchSchema>;

export type LaunchMatchOpponent = z.infer<typeof OpponentSchema>;
