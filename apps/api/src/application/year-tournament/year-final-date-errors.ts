import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import { formatFinalDateLabel } from '../../../lib/core/year-tournament/final-date-label.ts';
import type { FinalDateViolation } from '../../../lib/core/year-tournament/final-date-choice.ts';

interface YearFinalDateErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

export const YEAR_FINAL_DATE_ERRORS = Object.freeze({
  final_date_locked: {
    kind: 'unprocessable',
    message: '決勝実施日の7日前を過ぎたため変更できません。',
  },
  version_conflict: {
    kind: 'conflict',
    message:
      '他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。',
  },
} satisfies Readonly<Record<string, YearFinalDateErrorDefinition>>);

export type YearFinalDateErrorCode = keyof typeof YEAR_FINAL_DATE_ERRORS;

export const yearFinalDateError = (code: YearFinalDateErrorCode): AppError => {
  const { kind, message } = YEAR_FINAL_DATE_ERRORS[code];
  return new AppError({ kind, code, message });
};

export type FinalDateChoiceViolation = Exclude<FinalDateViolation, 'locked'>;

export interface FinalDateViolationContext {
  readonly previousFinalDate: BusinessDate | null;
  readonly nextExplicitFinalDate: BusinessDate | null;
}

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

const dateLabelOf = (date: BusinessDate | null): string =>
  date === null ? '' : formatFinalDateLabel(date);

const violationMessageOf = (
  violation: FinalDateChoiceViolation,
  context: FinalDateViolationContext,
): string => {
  switch (violation) {
    case 'year_not_editable':
      return '現在の年か翌年を選んでください。';
    case 'not_sunday':
      return '日曜日を選んでください。';
    case 'out_of_year':
      return '対象年の日付を選んでください。';
    case 'too_soon':
      return '現在から8日後以降の日付を選んでください。';
    case 'too_far_from_previous':
      return `前年の決勝実施日(${dateLabelOf(context.previousFinalDate)})から64週以上空く日付は選べません。`;
    case 'too_far_from_next':
      return `翌年の決勝実施日(${dateLabelOf(context.nextExplicitFinalDate)})まで64週以上空く日付は選べません。`;
  }
};

// GraphQLの引数の検証(withValidatedArgs)と同じ形の詳細にし、理由のコードで画面が文言を選べるようにする
export const finalDateValidationError = (
  violation: FinalDateChoiceViolation,
  context: FinalDateViolationContext,
): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [
      {
        field: violation === 'year_not_editable' ? 'year' : 'finalDate',
        code: violation,
        message: violationMessageOf(violation, context),
      },
    ],
  });
