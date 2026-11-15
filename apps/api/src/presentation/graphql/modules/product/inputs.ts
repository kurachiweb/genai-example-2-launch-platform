import { z } from 'zod';

import { checkAuditReason } from '../../../../../common-lib/admin/admin-input-rules.ts';
import {
  checkHandleFormat,
  type HandleFormatCheck,
} from '../../../../../common-lib/handles/handle-rules.ts';
import {
  checkProductName,
  checkTagline,
  PRODUCT_DESCRIPTION_RULE,
  PRODUCT_HANDLE_MESSAGES,
  PRODUCT_HANDLE_RULE,
  PRODUCT_NAME_MESSAGES,
  PRODUCT_SCREENSHOTS_MAX,
  PRODUCT_TAGLINE_MESSAGES,
} from '../../../../../common-lib/product/product-input-rules.ts';
import { USER_HANDLE_RULE } from '../../../../../common-lib/profile/profile-input-rules.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import {
  checkExternalUrl,
  type ExternalUrlCheck,
} from '../../../../../common-lib/url/external-url.ts';
import { markdownTextSchema } from '../../../../../common-lib/validation/markdown-text-schema.ts';
import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';
import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';
import { LAUNCH_HISTORY_PAGE_MAX } from '../../../../application/product/launch-history-reader.ts';
import type { ProductFieldsInput } from '../../../../application/product/ports.ts';
import { PRODUCT_STATE_BATCH_MAX } from '../../../../application/product/product-state-evaluator.ts';
import { inputRuleOf } from '../../auth-inputs.ts';
import { INPUT_MESSAGES } from './errors.ts';

// admin・inquiry・payments・フォローの一覧のカーソルと同じ上限。位置のカーソルはこれより十分に短い
export const PRODUCT_LIST_CURSOR_MAX = 256;

// 基盤のCURSOR_PAGE_ARGSは1〜100件のため、1ページの状態の判定の上限に合わせた件数の規則を各一覧で組み立てる。
// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる。空文字列は未指定ではなく不正なカーソルとして扱う
export function productPageArgsOf(maxPageSize: number) {
  const outOfRangeMessage = `表示する件数は1〜${String(maxPageSize)}件の整数で指定してください。`;
  return z.object({
    first: z
      .int(outOfRangeMessage)
      .min(1, outOfRangeMessage)
      .max(maxPageSize, outOfRangeMessage),
    after: z
      .string()
      .max(PRODUCT_LIST_CURSOR_MAX, invalidCursorError().message)
      .nullish()
      .transform((value) => value ?? undefined),
  });
}

export const MY_PRODUCTS_ARGS = productPageArgsOf(PRODUCT_STATE_BATCH_MAX);

// 利用者のハンドルの形式の違反は表示できない利用者としてユースケースがnullにする
export const LAUNCH_HISTORY_ARGS = productPageArgsOf(
  LAUNCH_HISTORY_PAGE_MAX,
).extend({ userHandle: z.string() });

const USER_HANDLE_MESSAGES = Object.freeze({
  ok: undefined,
  empty: INPUT_MESSAGES.userHandleRequired,
  'too-long': INPUT_MESSAGES.userHandleTooLong,
  'invalid-characters': INPUT_MESSAGES.userHandleFormat,
} satisfies Record<HandleFormatCheck, string | undefined>);

// 受賞の区画は表示できるプロフィールのハンドルでだけ呼ばれるため、形式の違反は画面の誤りとして拒否する。表示できない利用者はユースケースがnullにする
export const PROFILE_AWARDS_ARGS = z.object({
  userHandle: inputRuleOf(
    (value) => USER_HANDLE_MESSAGES[checkHandleFormat(value, USER_HANDLE_RULE)],
  ),
});

const handleTooLongMessage = PRODUCT_HANDLE_MESSAGES['too-long'];

// 51文字以上は形式の確認に値しないため、検証の失敗として拒否する。空や文字種の違反は判定の結果INVALIDで返す。
// 編集中のハンドルは本人のプロダクトの照会にだけ使い、一致しなければ登録と同じ判定になる
export const PRODUCT_HANDLE_AVAILABILITY_ARGS = z.object({
  handle: z.string().max(PRODUCT_HANDLE_RULE.maxLength, handleTooLongMessage),
  productHandle: z
    .string()
    .max(PRODUCT_HANDLE_RULE.maxLength, handleTooLongMessage)
    .nullish()
    .transform((value) => value ?? undefined),
});

// ULIDは26文字で、一致しない値はユースケースが不在のカテゴリや本人の画像でないものとして扱う。ここでは処理量だけを抑える
const ID_INPUT_MAX_LENGTH = 64;

const WEBSITE_URL_MESSAGES = Object.freeze({
  ok: undefined,
  empty: INPUT_MESSAGES.websiteUrlRequired,
  'too-long': INPUT_MESSAGES.websiteUrlTooLong,
  'not-absolute': INPUT_MESSAGES.websiteUrlFormat,
  'disallowed-scheme': INPUT_MESSAGES.websiteUrlFormat,
} satisfies Record<ExternalUrlCheck, string | undefined>);

// 判定と保存値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const name = inputRuleOf(
  (value) => PRODUCT_NAME_MESSAGES[checkProductName(value)],
).transform(trimWhiteSpace);

const tagline = inputRuleOf(
  (value) => PRODUCT_TAGLINE_MESSAGES[checkTagline(value)],
).transform(trimWhiteSpace);

// 大文字小文字は保存する表記のまま保ち、空白を含む値は形式の違反にする
const handle = inputRuleOf(
  (value) =>
    PRODUCT_HANDLE_MESSAGES[checkHandleFormat(value, PRODUCT_HANDLE_RULE)],
);

const websiteUrl = inputRuleOf(
  (value) => WEBSITE_URL_MESSAGES[checkExternalUrl(value)],
).transform(trimWhiteSpace);

const idOf = (message: string) => z.string().max(ID_INPUT_MAX_LENGTH, message);

const screenshotsMessageOf = (ids: readonly string[]): string | undefined => {
  if (ids.length > PRODUCT_SCREENSHOTS_MAX) {
    return INPUT_MESSAGES.screenshotsTooMany;
  }
  // 同じ画像を2つの位置に置くと画像の紐付けと表示順が食い違うため、画面の操作では起きない重複を拒否する
  return new Set(ids).size === ids.length
    ? undefined
    : INPUT_MESSAGES.imageInvalid;
};

// 欄には最初の1つの違反だけを示す
const screenshotFileIds = z
  .array(idOf(INPUT_MESSAGES.imageInvalid))
  .superRefine((ids, context) => {
    const message = screenshotsMessageOf(ids);
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });

// 選べる日かどうかはユースケースが判定し、ここでは存在する業務日付であることだけを確かめる
const launchDate = z.string().transform((value, context) => {
  try {
    return parseBusinessDate(value);
  } catch {
    context.addIssue({
      code: 'custom',
      message: INPUT_MESSAGES.launchDateRequired,
    });
    return z.NEVER;
  }
});

// 説明文のマークダウンは空白や改行に意味があるため値を変えず、ユースケースの入力の名前へ写す
const PRODUCT_FIELDS = z
  .object({
    name,
    tagline,
    categoryId: idOf(INPUT_MESSAGES.categoryInvalid),
    handle,
    websiteUrl,
    description: markdownTextSchema(PRODUCT_DESCRIPTION_RULE),
    logoFileId: idOf(INPUT_MESSAGES.imageInvalid),
    screenshotFileIds,
  })
  .transform(({ description, ...rest }): ProductFieldsInput => ({
    ...rest,
    descriptionMarkdown: description,
  }));

export const REGISTER_PRODUCT_ARGS = z.object({
  input: z.object({ fields: PRODUCT_FIELDS, launchDate }),
});

// 編集画面を開いたハンドルは照合だけに使い、一致しなければユースケースがproduct_not_foundにする。nullはローンチを変えない
export const UPDATE_PRODUCT_ARGS = z.object({
  input: z.object({
    productHandle: z.string(),
    expectedVersion: z.int(),
    fields: PRODUCT_FIELDS,
    launchDate: launchDate.nullish().transform((value) => value ?? null),
  }),
});

const reason = inputRuleOf((value) =>
  checkAuditReason(value) === undefined
    ? undefined
    : INPUT_MESSAGES.reasonTooLong,
)
  .nullish()
  .transform((value) => value ?? undefined);

const categoryId = idOf(INPUT_MESSAGES.categoryNotFound);

// カテゴリ名とハンドルの規則と名前の前後の空白の除去は、重複の判定と同じ値で行うためユースケースが行う
const PRODUCT_CATEGORY_INPUT = z.object({
  name: z.string(),
  handle: z.string(),
});

export const CREATE_PRODUCT_CATEGORY_ARGS = z.object({
  input: PRODUCT_CATEGORY_INPUT,
  reason,
});

export const UPDATE_PRODUCT_CATEGORY_ARGS = z.object({
  id: categoryId,
  input: PRODUCT_CATEGORY_INPUT,
  reason,
});

export const DELETE_PRODUCT_CATEGORY_ARGS = z.object({
  id: categoryId,
  reason,
});
