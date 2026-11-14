import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import {
  checkProductName,
  checkTagline,
  PRODUCT_DESCRIPTION_RULE,
  PRODUCT_HANDLE_MESSAGES,
  PRODUCT_HANDLE_RULE,
  PRODUCT_NAME_MESSAGES,
  PRODUCT_SCREENSHOTS_MAX,
  PRODUCT_TAGLINE_MESSAGES,
} from '../../../common-lib/product/product-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import {
  checkExternalUrl,
  type ExternalUrlCheck,
} from '../../../common-lib/url/external-url.ts';
import { markdownTextSchema } from '../../../common-lib/validation/markdown-text-schema.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import type { LaunchPlanView } from '../../graphql/my-products.ts';
import { showsLaunchDateCalendar } from './launch-date-field-values.ts';
import type { ProductBasicFieldValues } from './product-basic-field-values.ts';
import {
  CATEGORY_REQUIRED_MESSAGE,
  LOGO_REQUIRED_MESSAGE,
  PRODUCT_FORM_MESSAGES,
} from './product-form-messages.ts';

// 1つの欄には最初の1つの違反だけを示す
const ruleOf = (check: (value: string) => string | undefined) =>
  z.string().superRefine((value, context) => {
    const message = check(value);
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });

const WEBSITE_URL_MESSAGES = Object.freeze({
  ok: undefined,
  empty: PRODUCT_FORM_MESSAGES.websiteUrlRequired,
  'too-long': PRODUCT_FORM_MESSAGES.websiteUrlTooLong,
  'not-absolute': PRODUCT_FORM_MESSAGES.websiteUrlFormat,
  'disallowed-scheme': PRODUCT_FORM_MESSAGES.websiteUrlFormat,
} satisfies Record<ExternalUrlCheck, string | undefined>);

const DESCRIPTION_RULE = markdownTextSchema(PRODUCT_DESCRIPTION_RULE);

// 判定と送る値を食い違わせないよう、APIサーバーと同じ入力規則と空白の集合で前後を除く。ハンドルは保存する表記のまま保つ
const name = ruleOf(
  (value) => PRODUCT_NAME_MESSAGES[checkProductName(value)],
).transform(trimWhiteSpace);

const tagline = ruleOf(
  (value) => PRODUCT_TAGLINE_MESSAGES[checkTagline(value)],
).transform(trimWhiteSpace);

const handle = ruleOf(
  (value) =>
    PRODUCT_HANDLE_MESSAGES[checkHandleFormat(value, PRODUCT_HANDLE_RULE)],
);

const websiteUrl = ruleOf(
  (value) => WEBSITE_URL_MESSAGES[checkExternalUrl(value)],
).transform(trimWhiteSpace);

// マークダウンは空白や改行に意味があるため値を変えない。共用の検証規則は入力の型が未指定のため、文字列の入力として包む
const description = ruleOf(
  (value) => DESCRIPTION_RULE.safeParse(value).error?.issues[0]?.message,
);

const categoryId = z.string().min(1, CATEGORY_REQUIRED_MESSAGE);

const logoFileId = z
  .string()
  .nullable()
  .transform((value, context) => {
    if (value === null) {
      context.addIssue({ code: 'custom', message: LOGO_REQUIRED_MESSAGE });
      return z.NEVER;
    }
    return value;
  });

const screenshotFileIds = z
  .array(z.string())
  .max(PRODUCT_SCREENSHOTS_MAX, PRODUCT_FORM_MESSAGES.screenshotsTooMany);

const FIELD_SHAPE = Object.freeze({
  name,
  tagline,
  categoryId,
  handle,
  websiteUrl,
  description,
  logoFileId,
  screenshotFileIds,
});

// 登録はローンチ日を必須とし、選んだ日を送る
const requiredLaunchDate = z
  .string()
  .nullable()
  .transform((value, context) => {
    if (value === null) {
      context.addIssue({
        code: 'custom',
        message: PRODUCT_FORM_MESSAGES.launchDateRequired,
      });
      return z.NEVER;
    }
    return value;
  });

// フォームの値はRegisterProductInput・UpdateProductInputと同じく編集する値をfieldsの下に、ローンチ日をその外に置き、サーバーの詳細の経路(input.fields.<名前>・input.launchDate)から引数の名前を除いた経路を欄の名前にそろえる
export const REGISTER_PRODUCT_FORM_SCHEMA = z.object({
  fields: z.object(FIELD_SHAPE),
  launchDate: requiredLaunchDate,
});

// 編集は固定の期間にカテゴリの欄を無効にし、無効の欄の値は送る値から外れるため任意にする。読み込んだカテゴリは送る時に足す
const EDIT_FIELDS = z.object({
  ...FIELD_SHAPE,
  categoryId: categoryId.optional(),
});

// 編集画面を開いたハンドルと読み込んだ版は入力欄を描かないため含めず、送る時に読み込んだ値から足す。ローンチ日の欄を描かない間はローンチ日を含めず、送る時にnull(ローンチを変えない)を足す
export const EDIT_PRODUCT_FORM_SCHEMAS = Object.freeze({
  withLaunchDate: z.object({
    fields: EDIT_FIELDS,
    launchDate: z.string().nullable(),
  }),
  withoutLaunchDate: z.object({ fields: EDIT_FIELDS }),
});

// ローンチ日の欄を描かない間のフォームの値にもローンチ日が残り得るため、ローンチ日を任意にした、全てのスキーマの入力を受け付ける形
export type ProductFormInput = Omit<
  z.input<typeof EDIT_PRODUCT_FORM_SCHEMAS.withLaunchDate>,
  'launchDate'
> & { launchDate?: string | null };

export type RegisterProductFormOutput = z.output<
  typeof REGISTER_PRODUCT_FORM_SCHEMA
>;

export type EditProductFormOutput = z.output<
  typeof EDIT_PRODUCT_FORM_SCHEMAS.withoutLaunchDate
> & { launchDate?: string | null };

export type EditProductFormSchema = z.ZodType<
  EditProductFormOutput,
  ProductFormInput
>;

// 計画を取り直してカレンダーの有無が変わっても、定数のスキーマを選び直すだけでフォームの検証し直しはuseAppFormに任せる
export const editProductFormSchemaOf = (
  plan: LaunchPlanView,
): EditProductFormSchema =>
  showsLaunchDateCalendar(plan)
    ? EDIT_PRODUCT_FORM_SCHEMAS.withLaunchDate
    : EDIT_PRODUCT_FORM_SCHEMAS.withoutLaunchDate;

type IsSameType<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

type BasicFieldNames = keyof ProductBasicFieldValues['fields'];

// 基本の欄の部品はフォームの文脈をProductBasicFieldValuesとして読むため、登録のフォームの入力の同じ名前の欄がそれと同じ型であることを型検査で確かめる
export const BASIC_FIELD_VALUES_MATCH: IsSameType<
  Pick<z.input<typeof REGISTER_PRODUCT_FORM_SCHEMA>['fields'], BasicFieldNames>,
  ProductBasicFieldValues['fields']
> = true;
