import { z } from 'zod';

import { checkAuditReason } from '../../../../../common-lib/admin/admin-input-rules.ts';
import { checkHandleFormat } from '../../../../../common-lib/handles/handle-rules.ts';
import type { HelpArticleStatus } from '../../../../../common-lib/help/help-article-status.ts';
import {
  checkHelpSubtitle,
  checkHelpTitle,
  HELP_ARTICLE_HANDLE_RULE,
  HELP_BODY_RULE,
  HELP_REORDER_MAX,
  type HelpTextCheck,
} from '../../../../../common-lib/help/help-input-rules.ts';
import { normalizeHelpSearchText } from '../../../../../common-lib/help/help-query-rules.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import { markdownTextSchema } from '../../../../../common-lib/validation/markdown-text-schema.ts';
import type { HelpArticleWrite } from '../../../../application/help/ports.ts';
import { inputRuleOf } from '../../auth-inputs.ts';
import type { HelpArticleStatus as GraphQLHelpArticleStatus } from '../../generated/resolvers-types.ts';
import { INPUT_MESSAGES } from './errors.ts';

// カテゴリ・記事のIDは26文字のULIDで、一致しない値はユースケースが見つからないとして扱う。ここでは処理量だけを抑える
const ID_INPUT_MAX_LENGTH = 64;

const idOf = (message: string) => z.string().max(ID_INPUT_MAX_LENGTH, message);

const categoryId = idOf(INPUT_MESSAGES.categoryNotFound);

const articleId = idOf(INPUT_MESSAGES.articleNotFound);

const orderedIds = z
  .array(idOf(INPUT_MESSAGES.orderInvalid))
  .min(1, INPUT_MESSAGES.orderInvalid)
  .max(HELP_REORDER_MAX, INPUT_MESSAGES.orderInvalid)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    INPUT_MESSAGES.orderInvalid,
  );

// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる
const reason = inputRuleOf((value) =>
  checkAuditReason(value) === undefined
    ? undefined
    : INPUT_MESSAGES.reasonTooLong,
)
  .nullish()
  .transform((value) => value ?? undefined);

// カテゴリ名の規則と前後の空白の除去は、名前の重複の判定と同じ値で行うためユースケースが行う
export const CREATE_HELP_CATEGORY_ARGS = z.object({ name: z.string() });

export const RENAME_HELP_CATEGORY_ARGS = z.object({
  id: categoryId,
  name: z.string(),
});

export const DELETE_HELP_CATEGORY_ARGS = z.object({ id: categoryId });

export const REORDER_HELP_CATEGORIES_ARGS = z.object({ orderedIds });

const STATUS_FROM_GRAPHQL = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
} as const satisfies Record<GraphQLHelpArticleStatus, HelpArticleStatus>);

// 判定と保存値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const helpTextOf = (
  check: (value: string) => HelpTextCheck | undefined,
  messages: Readonly<Record<HelpTextCheck, string>>,
) =>
  inputRuleOf((value) => {
    const issue = check(value);
    return issue === undefined ? undefined : messages[issue];
  }).transform(trimWhiteSpace);

const title = helpTextOf(checkHelpTitle, INPUT_MESSAGES.title);

const subtitle = helpTextOf(checkHelpSubtitle, INPUT_MESSAGES.subtitle);

// 大文字小文字は保存する表記のまま保ち、空白を含む値は形式の違反にする
const handle = inputRuleOf(
  (value) =>
    INPUT_MESSAGES.handle[checkHandleFormat(value, HELP_ARTICLE_HANDLE_RULE)],
);

// 本文のマークダウンは空白や改行に意味があるため値を変えず、ユースケースの入力の名前へ写す
const HELP_ARTICLE_FIELDS = z
  .object({
    handle,
    title,
    subtitle,
    body: markdownTextSchema(HELP_BODY_RULE),
    categoryId: idOf(INPUT_MESSAGES.categoryMissing),
    pinned: z.boolean(),
    status: z.enum(['DRAFT', 'PUBLISHED']),
  })
  .transform(({ body, status, ...rest }): HelpArticleWrite => ({
    ...rest,
    bodyMarkdown: body,
    status: STATUS_FROM_GRAPHQL[status],
  }));

export const CREATE_HELP_ARTICLE_ARGS = z.object({
  input: z.object({ fields: HELP_ARTICLE_FIELDS, reason }),
});

export const UPDATE_HELP_ARTICLE_ARGS = z.object({
  input: z.object({
    id: articleId,
    expectedRevision: z.int(),
    fields: HELP_ARTICLE_FIELDS,
    reason,
  }),
});

export const DELETE_HELP_ARTICLE_ARGS = z.object({ id: articleId, reason });

export const ADMIN_HELP_ARTICLE_ARGS = z.object({ id: articleId });

// 51文字以上は形式の確認に値しないため、検証の失敗として拒否する。空や文字種の違反は判定の結果INVALIDで返す。
// 編集中の記事のIDが一致しなければ、新しい記事と同じ判定になる
export const HELP_ARTICLE_HANDLE_AVAILABILITY_ARGS = z.object({
  handle: z
    .string()
    .max(HELP_ARTICLE_HANDLE_RULE.maxLength, INPUT_MESSAGES.handle['too-long']),
  articleId: articleId.nullish().transform((value) => value ?? undefined),
});

// カテゴリの不在は、そのカテゴリの記事の集合が表示中の並びと違う場合と同じく古い並びとして扱う
export const REORDER_HELP_ARTICLES_ARGS = z.object({
  categoryId: idOf(INPUT_MESSAGES.orderInvalid),
  orderedIds,
});

// URLのクエリの値を受けるため、上限を超えた検索語も拒否せず前後の空白を除いて上限の文字数に切り詰める。空白だけはundefined
export const HELP_ARTICLE_SEARCH_ARGS = z.object({
  query: z.string().transform(normalizeHelpSearchText),
});
