import { PRODUCT_CATEGORY_OTHER_NAME } from '../../../common-lib/product/product-category-constants.ts';
import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import {
  type BusinessDate,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import type { LaunchDateUnavailableReason } from '../../domain/product/launch-date-rules.ts';
import type { PlanBlock } from '../../domain/product/launch-plan.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';

interface ProductErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

const HANDLE_TAKEN_MESSAGE =
  'このハンドルは既に使われています。別の文字列を入力してください。';

// 利用者に見せる文言は文言規則のエラーメッセージと同じにする。選んだ日によって文言が変わるlaunch_date_unavailableはlaunchDateUnavailableErrorで作る
export const PRODUCT_ERRORS = Object.freeze({
  handle_unavailable: { kind: 'conflict', message: HANDLE_TAKEN_MESSAGE },
  product_hidden: {
    kind: 'conflict',
    message:
      'このプロダクトは公開が停止されているため、説明文を更新できません。',
  },
  product_locked: {
    kind: 'conflict',
    message:
      'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。',
  },
  decision_unavailable: {
    kind: 'unavailable',
    message:
      'ローンチの状態を確認できませんでした。時間をおいて再度お試しください。',
  },
  product_update_conflict: {
    kind: 'conflict',
    message:
      'プロダクトが別の画面で変更されました。最新の内容を読み込んでから操作してください。',
  },
  product_not_found: {
    kind: 'not_found',
    message: 'プロダクトが見つかりません。',
  },
  category_not_found: {
    kind: 'unprocessable',
    message: 'カテゴリをもう一度選択してください。',
  },
  invalid_upload: {
    kind: 'unprocessable',
    message: '画像をもう一度選択してください。',
  },
  screenshot_limit_exceeded: {
    kind: 'unprocessable',
    message: 'スクリーンショットは20枚・合計10MB以内にしてください。',
  },
  product_category_name_taken: {
    kind: 'conflict',
    message: 'このカテゴリ名は既に使われています。',
  },
  product_category_handle_taken: {
    kind: 'conflict',
    message: HANDLE_TAKEN_MESSAGE,
  },
  product_category_protected: {
    kind: 'unprocessable',
    message: `標準カテゴリ「${PRODUCT_CATEGORY_OTHER_NAME}」は変更・削除できません。`,
  },
  product_category_in_use: {
    kind: 'conflict',
    message:
      'このカテゴリにはプロダクトが紐付いているため削除できません。削除から14日以内のプロダクトも含みます。',
  },
  account_unavailable: IDENTITY_ERRORS.account_unavailable,
} satisfies Readonly<Record<string, ProductErrorDefinition>>);

export type ProductErrorCode = keyof typeof PRODUCT_ERRORS;

const HANDLE_FIELD_CODES: ReadonlySet<ProductErrorCode> = new Set([
  'handle_unavailable',
  'product_category_handle_taken',
]);

export const productError = (code: ProductErrorCode): AppError => {
  const { kind, message } = PRODUCT_ERRORS[code];
  if (HANDLE_FIELD_CODES.has(code)) {
    return new AppError({
      kind,
      code,
      message,
      details: [{ field: 'handle', code: 'unavailable', message }],
    });
  }
  return new AppError({ kind, code, message });
};

export interface LaunchDateRejection {
  readonly reason: LaunchDateUnavailableReason;
  readonly earliest: BusinessDate;
  readonly latest: BusinessDate;
}

const LAUNCH_DATE_FIELD = 'launchDate';

const yearOf = (date: BusinessDate): number => Number(date.slice(0, 4));

// 文言規則の日付の示し方: 今年なら月日だけ、今年でなければ年を付ける
const formatLaunchDate = (date: BusinessDate, currentYear: number): string => {
  const [year, month, day] = date.split('-').map(Number);
  const monthDay = `${String(month)}月${String(day)}日`;
  return year === currentYear ? monthDay : `${String(year)}年${monthDay}`;
};

export const launchDateUnavailableError = (
  rejection: LaunchDateRejection,
  now: Date,
): AppError => {
  const currentYear = yearOf(toBusinessDateTime(now).date);
  const earliest = formatLaunchDate(rejection.earliest, currentYear);
  const message =
    rejection.reason === 'relaunch_interval'
      ? `このプロダクトは${earliest}以降のローンチ日を選べます。`
      : `ローンチ日は${earliest}〜${formatLaunchDate(rejection.latest, currentYear)}の間で選んでください。`;
  return new AppError({
    kind: 'unprocessable',
    code: 'launch_date_unavailable',
    message,
    details: [{ field: LAUNCH_DATE_FIELD, code: rejection.reason, message }],
  });
};

// 非公開化中の予約の拒否はproduct_hiddenで返し、説明文の更新の拒否と同じコードで予約の文言を使う
export const relaunchBlockedError = (block: PlanBlock): AppError =>
  new AppError({
    kind: 'conflict',
    code:
      block.code === 'product_hidden' ? 'product_hidden' : 'relaunch_blocked',
    message: block.message,
  });

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

// GraphQLの引数の検証(withValidatedArgs)と同じ形の詳細にする
export const productDescriptionRejectedError = (message: string): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [{ field: 'descriptionMarkdown', code: 'custom', message }],
  });
