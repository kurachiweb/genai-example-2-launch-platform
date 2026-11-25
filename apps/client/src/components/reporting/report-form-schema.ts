import {
  checkReportReason,
  REPORT_CONTACT_EMAIL_MAX,
  REPORT_REASON_MAX,
  type ReportReasonCheck,
} from '../../../common-lib/reporting/report-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { formatCount } from '../../../lib/utilities/messages/length-limit-messages.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import { ACCOUNT_FORM_MESSAGES } from '../auth/account-form-schemas.ts';

// APIサーバーの入力の検証と同じ文言にする(文言規則のエラーメッセージ)
const CATEGORY_REQUIRED_MESSAGE = 'カテゴリを選んでください。';

const CONTACT_EMAIL_REQUIRED_MESSAGE =
  '連絡先メールアドレスを入力してください。';

const REASON_MESSAGES: Readonly<Record<ReportReasonCheck, string | undefined>> =
  Object.freeze({
    ok: undefined,
    empty: '理由を入力してください。',
    'too-long': `理由は${formatCount(REPORT_REASON_MAX)}文字以内で入力してください。`,
  });

// 1つの欄には最初の1つの違反だけを示す
const ruleOf = (check: (value: string) => string | undefined) =>
  z.string().superRefine((value, context) => {
    const message = check(value);
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });

const categoryId = ruleOf((value) =>
  value === '' ? CATEGORY_REQUIRED_MESSAGE : undefined,
);

// 理由は空白や改行に意味があるため、APIサーバーと同じく値を変えずに送る
const reason = ruleOf((value) => REASON_MESSAGES[checkReportReason(value)]);

const checkContactEmail = (value: string): string | undefined => {
  const trimmed = trimWhiteSpace(value);
  if (trimmed === '') {
    return CONTACT_EMAIL_REQUIRED_MESSAGE;
  }
  if (trimmed.length > REPORT_CONTACT_EMAIL_MAX) {
    return ACCOUNT_FORM_MESSAGES.emailTooLong;
  }
  return z.regexes.html5Email.test(trimmed)
    ? undefined
    : ACCOUNT_FORM_MESSAGES.emailFormat;
};

const contactEmail = ruleOf(checkContactEmail).transform(trimWhiteSpace);

// 連絡先の欄を描かない間は、残った値を送らないよう連絡先を持たないスキーマを使う。Zodのオブジェクトは知らない項目を出力から除く
export const REPORT_FORM_SCHEMA = z.object({ categoryId, reason });

export const REPORT_FORM_WITH_CONTACT_SCHEMA = z.object({
  categoryId,
  reason,
  contactEmail,
});

// 連絡先を持たないスキーマも受けるよう連絡先は任意にし、既定値には全欄を入れる
export interface ReportFormInput {
  readonly categoryId: string;
  readonly reason: string;
  readonly contactEmail?: string;
}

export interface ReportFormOutput {
  readonly categoryId: string;
  readonly reason: string;
  readonly contactEmail?: string;
}
