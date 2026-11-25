import { z } from 'zod';

import { CATEGORY_NAME_MAX } from '../../../../../common-lib/admin/admin-input-rules.ts';
import {
  checkInquiryMessage,
  REPORT_ADMIN_REASON_MAX,
  REPORT_LIST_PAGE_SIZE,
} from '../../../../../common-lib/reporting/report-case-rules.ts';
import { checkReportReason } from '../../../../../common-lib/reporting/report-rules.ts';
import { countGraphemes } from '../../../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import { UPPERCASE_ULID_PATTERN } from '../../../../../lib/core/ids/uppercase-ulid.ts';
import type { ReportCaseFilter } from '../../../../application/reporting/ports.ts';
import { inputRuleOf } from '../../auth-inputs.ts';
import { REPORT_CASE_STATUSES, REPORT_TARGET_KINDS } from './enums.ts';
import { REPORTING_INPUT_MESSAGES } from './errors.ts';

const REPORT_TARGET_REF_MAX_LENGTH = 100;

// 値の範囲はGraphQLの列挙型が確かめるため、ユースケースの値への写しだけを行う
const enumOf = <TTable extends Readonly<Record<string, string>>>(
  table: TTable,
) =>
  z
    .enum(Object.keys(table) as [keyof TTable & string])
    .transform((value): TTable[keyof TTable] => table[value]);

const optionalEnumOf = <TTable extends Readonly<Record<string, string>>>(
  table: TTable,
) =>
  enumOf(table)
    .nullish()
    .transform((value) => value ?? undefined);

// 欄ごとの詳細を1件にするため、ULIDの形式の違反で大文字の検査を止める
const uppercaseUlidOf = (message: string) =>
  z
    .ulid({ error: message, abort: true })
    .regex(UPPERCASE_ULID_PATTERN, message);

const caseId = uppercaseUlidOf(REPORTING_INPUT_MESSAGES.caseIdInvalid);

const categoryId = uppercaseUlidOf(REPORTING_INPUT_MESSAGES.categoryIdInvalid);

const pageSize = z
  .int(REPORTING_INPUT_MESSAGES.pageSize)
  .min(1, REPORTING_INPUT_MESSAGES.pageSize)
  .max(REPORT_LIST_PAGE_SIZE, REPORTING_INPUT_MESSAGES.pageSize);

// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる。不正な位置は案件の照会がinvalid_cursorにする
const pageCursor = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

const reportedAt = z
  .number()
  .nullish()
  .transform((value) => (value == null ? undefined : new Date(value)));

const exceedsGraphemes = (value: string, max: number): boolean =>
  countGraphemes(trimWhiteSpace(value)) > max;

// 前後の空白を除いた保存の値と要否はユースケースが決めるため、上限だけを確かめて入力のまま渡す
const upperLimitOf = (max: number, message: string) =>
  inputRuleOf((value) => (exceedsGraphemes(value, max) ? message : undefined));

const adminReason = upperLimitOf(
  REPORT_ADMIN_REASON_MAX,
  REPORTING_INPUT_MESSAGES.adminReasonTooLong,
);

const optionalAdminReason = adminReason
  .nullish()
  .transform((value) => value ?? undefined);

const inquiryMessage = inputRuleOf((value) =>
  checkInquiryMessage(value) === 'too-long'
    ? REPORTING_INPUT_MESSAGES.inquiryMessageTooLong
    : undefined,
);

const categoryName = upperLimitOf(
  CATEGORY_NAME_MAX,
  REPORTING_INPUT_MESSAGES.categoryNameTooLong,
);

// 理由は空白や改行に意味があるため値を変えずに渡し、受け付けのユースケースは検証済みの値として保存する
const reportReason = inputRuleOf(
  (value) => REPORTING_INPUT_MESSAGES.reason[checkReportReason(value)],
);

// 連絡先の要否は通報者の種類で決まり、長さと形式は要るときだけリゾルバが確かめるため、ここでは前後の空白を除くだけにする
const contactEmail = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = trimWhiteSpace(value ?? '');
    return trimmed === '' ? undefined : trimmed;
  });

const targetRef = z
  .string()
  .min(1, REPORTING_INPUT_MESSAGES.targetRefInvalid)
  .max(REPORT_TARGET_REF_MAX_LENGTH, REPORTING_INPUT_MESSAGES.targetRefInvalid);

// 省略可能な項目を、値のある条件だけを持つオブジェクトにする
const definedEntriesOf = <T extends object>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };

export const SUBMIT_REPORT_ARGS = z.object({
  input: z.object({
    targetKind: enumOf(REPORT_TARGET_KINDS),
    targetRef,
    categoryId: uppercaseUlidOf(REPORTING_INPUT_MESSAGES.reportCategoryInvalid),
    reason: reportReason,
    contactEmail,
  }),
});

export const ADMIN_REPORT_CASES_ARGS = z.object({
  filter: z
    .object({
      status: optionalEnumOf(REPORT_CASE_STATUSES),
      targetKind: optionalEnumOf(REPORT_TARGET_KINDS),
      categoryId: categoryId.nullish().transform((value) => value ?? undefined),
      reportedFrom: reportedAt,
      reportedBefore: reportedAt,
    })
    .refine(
      ({ reportedFrom, reportedBefore }) =>
        reportedFrom === undefined ||
        reportedBefore === undefined ||
        reportedFrom < reportedBefore,
      {
        message: REPORTING_INPUT_MESSAGES.periodReversed,
        path: ['reportedBefore'],
      },
    )
    .nullish()
    .transform((filter): ReportCaseFilter => definedEntriesOf(filter ?? {})),
  first: pageSize,
  after: pageCursor,
});

export const ADMIN_REPORT_CASE_ARGS = z.object({ id: caseId });

export const ADMIN_PRODUCT_REPORT_SUMMARY_ARGS = z.object({
  productId: uppercaseUlidOf(REPORTING_INPUT_MESSAGES.productIdInvalid),
});

export const CHANGE_REPORT_CASE_STATUS_ARGS = z.object({
  id: caseId,
  from: enumOf(REPORT_CASE_STATUSES),
  to: enumOf(REPORT_CASE_STATUSES),
  reason: optionalAdminReason,
});

// 措置による対応済・措置なしの対応済・却下の引数
export const REPORT_CASE_CLOSING_ARGS = z.object({
  id: caseId,
  reason: adminReason,
});

export const SEND_INFRINGEMENT_INQUIRY_ARGS = z.object({
  id: caseId,
  message: inquiryMessage,
  reason: optionalAdminReason,
});

export const CREATE_REPORT_CATEGORY_ARGS = z.object({
  name: categoryName,
  reason: optionalAdminReason,
});

export const RENAME_REPORT_CATEGORY_ARGS = z.object({
  id: categoryId,
  name: categoryName,
  reason: optionalAdminReason,
});

export const DELETE_REPORT_CATEGORY_ARGS = z.object({
  id: categoryId,
  reason: optionalAdminReason,
});
