import { z } from '@hono/zod-openapi';

import {
  PRODUCT_DESCRIPTION_MAX_GRAPHEMES,
  PRODUCT_DESCRIPTION_RULE,
} from '../../../../../common-lib/product/product-input-rules.ts';
import { markdownTextSchema } from '../../../../../common-lib/validation/markdown-text-schema.ts';
import { cursorListEnvelope } from '../../responses.ts';
import { PUBLIC_API_INVALID_TYPE_MESSAGE } from './common.ts';

const countFormat = new Intl.NumberFormat('ja-JP');

const DESCRIPTION_RULE = markdownTextSchema(PRODUCT_DESCRIPTION_RULE);

// 項目の欠落を空の入力と同じ文言で示すため、プロダクトの編集画面の規則が空の値に返す文言を使う
const DESCRIPTION_REQUIRED_MESSAGE =
  DESCRIPTION_RULE.safeParse('').error?.issues[0]?.message ??
  PUBLIC_API_INVALID_TYPE_MESSAGE;

// 型の誤りを他の本文と同じ文言にするため文字列であることを先に確かめ、プロダクトの編集画面と同じ規則の最初の1つの違反だけを示す。マークダウンは空白や改行に意味があるため値を変えない
const descriptionMarkdown = z
  .string({
    error: (issue) =>
      issue.input === undefined
        ? DESCRIPTION_REQUIRED_MESSAGE
        : PUBLIC_API_INVALID_TYPE_MESSAGE,
  })
  .superRefine((value, context) => {
    const message = DESCRIPTION_RULE.safeParse(value).error?.issues[0]?.message;
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });

export const MyProductParamsSchema = z.object({
  handle: z.string().openapi({
    description:
      'キーの持ち主のプロダクトのハンドル(大文字小文字を区別しない)。保持中の旧ハンドルは現在のハンドルのプロダクトとして扱う。',
    example: 'rocketship',
  }),
});

export const MyProductDescriptionBodySchema = z
  .object(
    {
      description_markdown: descriptionMarkdown.openapi({
        description: `説明文のマークダウン(必須、${countFormat.format(PRODUCT_DESCRIPTION_MAX_GRAPHEMES)}文字以内)。値はそのまま保存する。`,
      }),
    },
    { error: PUBLIC_API_INVALID_TYPE_MESSAGE },
  )
  .openapi('MyProductDescriptionUpdate', {
    description:
      'プロダクトの編集画面と同じ規則で検証し、説明文を置き換える。空・空白だけ・文字数の超過・使用できない文字を含む値は400(validation_error)になる。',
  });

export const MyProductSchema = z
  .object({
    id: z.string(),
    handle: z.string(),
    name: z.string(),
    description_markdown: z.string(),
    listed: z.boolean().openapi({
      description:
        'ディレクトリに掲載中かどうか。未掲載のプロダクトはプロダクトの詳細などの経路では見つからない(404)。',
    }),
    hidden: z.boolean().openapi({
      description:
        '管理者により非公開化されているかどうか。非公開化中は説明文を更新できない(409)。',
    }),
    page_url: z.url().openapi({ description: 'プロダクトのページのURL' }),
  })
  .openapi('MyProduct');

export const MyProductListSchema = cursorListEnvelope(MyProductSchema);

export type MyProductDescriptionBody = z.infer<
  typeof MyProductDescriptionBodySchema
>;

export type MyProduct = z.infer<typeof MyProductSchema>;

export type MyProductList = z.infer<typeof MyProductListSchema>;
