import type { PeriodViolations } from '../../../common-lib/sponsorship/sponsorship-period.ts';
import {
  AppError,
  type AppErrorKind,
  type FieldErrorDetail,
} from '../../../lib/core/errors/app-error.ts';
import { SPONSORSHIP_OFFER_REJECTION_MESSAGES } from '../../../lib/core/sponsorship/offer-rejection.ts';

interface SponsorshipErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 購入の可否の口と同じ拒否は、文言をその口の定数から読み、申込の受付と決済の開始で文言をそろえる
export const SPONSORSHIP_ERRORS = Object.freeze({
  sponsorship_product_ineligible: {
    kind: 'unprocessable',
    message:
      SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_product_ineligible,
  },
  sponsorship_overlap: {
    kind: 'conflict',
    message: SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_overlap,
  },
  sponsorship_not_found: {
    kind: 'not_found',
    message: 'この申込は見つかりませんでした。',
  },
  sponsorship_not_payable: {
    kind: 'conflict',
    message: SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_not_payable,
  },
} satisfies Readonly<Record<string, SponsorshipErrorDefinition>>);

export type SponsorshipErrorCode = keyof typeof SPONSORSHIP_ERRORS;

export const sponsorshipError = (code: SponsorshipErrorCode): AppError => {
  const { kind, message } = SPONSORSHIP_ERRORS[code];
  return new AppError({ kind, code, message });
};

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

const START_VIOLATION_MESSAGE =
  '開始日は今日から1年以内の日付を選んでください。';

const END_VIOLATION_MESSAGE =
  '終了日は開始日から366日以内の、開始日以降の日付を選んでください。';

const detailCodeOf = (violation: string): string =>
  violation.replaceAll('-', '_');

// GraphQLの引数の検証(withValidatedArgs)と同じ形の詳細にし、理由のコードで画面が項目を選べるようにする
export const sponsorshipPeriodValidationError = (
  violations: PeriodViolations,
): AppError => {
  const details: readonly FieldErrorDetail[] = [
    ...(violations.startsOn === undefined
      ? []
      : [
          {
            field: 'startsOn',
            code: detailCodeOf(violations.startsOn),
            message: START_VIOLATION_MESSAGE,
          },
        ]),
    ...(violations.endsOn === undefined
      ? []
      : [
          {
            field: 'endsOn',
            code: detailCodeOf(violations.endsOn),
            message: END_VIOLATION_MESSAGE,
          },
        ]),
  ];
  return new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details,
  });
};
