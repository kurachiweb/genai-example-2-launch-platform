import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import {
  checkHelpSubtitle,
  checkHelpTitle,
  HELP_ARTICLE_HANDLE_RULE,
  HELP_BODY_RULE,
} from '../../../common-lib/help/help-input-rules.ts';
import { HELP_ARTICLE_STATUSES } from '../../../common-lib/help/help-article-status.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { markdownTextSchema } from '../../../common-lib/validation/markdown-text-schema.ts';
import { REASON_SCHEMAS } from '../../../lib/components/admin/reason-schema.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import {
  HELP_CATEGORY_REQUIRED_MESSAGE,
  HELP_HANDLE_MESSAGES,
  HELP_SUBTITLE_MESSAGES,
  HELP_TITLE_MESSAGES,
} from './help-messages.ts';

// 1つの欄には最初の1つの違反だけを示す
const ruleOf = (check: (value: string) => string | undefined) =>
  z.string().superRefine((value, context) => {
    const message = check(value);
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });

const BODY_RULE = markdownTextSchema(HELP_BODY_RULE);

// 判定と送る値を食い違わせないよう、APIサーバーと同じ入力規則と空白の集合で前後を除く
const title = ruleOf((value) => {
  const issue = checkHelpTitle(value);
  return issue === undefined ? undefined : HELP_TITLE_MESSAGES[issue];
}).transform(trimWhiteSpace);

const subtitle = ruleOf((value) => {
  const issue = checkHelpSubtitle(value);
  return issue === undefined ? undefined : HELP_SUBTITLE_MESSAGES[issue];
}).transform(trimWhiteSpace);

// 大文字小文字は保存する表記のまま保つ
const handle = ruleOf(
  (value) =>
    HELP_HANDLE_MESSAGES[checkHandleFormat(value, HELP_ARTICLE_HANDLE_RULE)],
);

// マークダウンは空白や改行に意味があるため値を変えない。共用の検証規則は入力の型が未指定のため、文字列の入力として包む
const body = ruleOf(
  (value) => BODY_RULE.safeParse(value).error?.issues[0]?.message,
);

const categoryId = z.string().min(1, HELP_CATEGORY_REQUIRED_MESSAGE);

// フォームの値はCreateHelpArticleInput・UpdateHelpArticleInputと同じく編集する値をfieldsの下に、理由をその外に置き、サーバーの詳細の経路(input.fields.<名前>・input.reason)から引数の名前を除いた経路を欄の名前にそろえる。
// 編集する記事のIDと読み込んだ版は入力欄を描かないため含めず、送る時に読み込んだ記事から足す
export const HELP_ARTICLE_FORM_SCHEMA = z.object({
  fields: z.object({
    title,
    subtitle,
    handle,
    categoryId,
    pinned: z.boolean(),
    status: z.enum(HELP_ARTICLE_STATUSES),
    body,
  }),
  reason: REASON_SCHEMAS.optional,
});

export type HelpArticleFormInput = z.input<typeof HELP_ARTICLE_FORM_SCHEMA>;

export type HelpArticleFormOutput = z.output<typeof HELP_ARTICLE_FORM_SCHEMA>;
