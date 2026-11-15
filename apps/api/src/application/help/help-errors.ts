import {
  CATEGORY_NAME_MESSAGES,
  type CategoryNameIssue,
} from '../../../common-lib/admin/admin-input-rules.ts';
import { HELP_CATEGORY_OTHER_NAME } from '../../../common-lib/help/help-category-constants.ts';
import {
  AppError,
  type AppErrorKind,
  type FieldErrorDetail,
} from '../../../lib/core/errors/app-error.ts';

interface HelpErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 利用者に見せる文言は文言規則のエラーメッセージと同じにする
export const HELP_ERRORS = Object.freeze({
  help_article_handle_unavailable: {
    kind: 'conflict',
    message: 'このハンドルは既に使われています。別の文字列を入力してください。',
  },
  help_article_conflict: {
    kind: 'conflict',
    message:
      'このヘルプ記事は別の画面で変更されました。最新の内容を読み込んでから保存してください。',
  },
  help_article_not_found: {
    kind: 'not_found',
    message: 'このヘルプ記事は削除されています。',
  },
  help_order_outdated: {
    kind: 'conflict',
    message:
      '並び順が別の画面で変更されました。最新の並びを読み込んでから並べ替えてください。',
  },
  help_category_name_taken: {
    kind: 'conflict',
    message: '同じ名前のカテゴリが既にあります。',
  },
  help_category_protected: {
    kind: 'conflict',
    message: `標準カテゴリ「${HELP_CATEGORY_OTHER_NAME}」は変更・削除できません。`,
  },
  help_category_not_found: {
    kind: 'not_found',
    message: 'このカテゴリは削除されています。',
  },
} satisfies Readonly<Record<string, HelpErrorDefinition>>);

export type HelpErrorCode = keyof typeof HELP_ERRORS;

// 入力欄に理由を示すため、重複の拒否は欄の詳細を持つ
const FIELD_OF_CODE: Partial<
  Readonly<
    Record<HelpErrorCode, { readonly field: string; readonly code: string }>
  >
> = Object.freeze({
  help_article_handle_unavailable: { field: 'handle', code: 'unavailable' },
  help_category_name_taken: { field: 'name', code: 'name-taken' },
});

export const helpError = (code: HelpErrorCode): AppError => {
  const { kind, message } = HELP_ERRORS[code];
  const field = FIELD_OF_CODE[code];
  return new AppError({
    kind,
    code,
    message,
    ...(field === undefined ? {} : { details: [{ ...field, message }] }),
  });
};

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

// GraphQLの引数の検証(withValidatedArgs)と同じ形の詳細にする
const validationError = (detail: FieldErrorDetail): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [detail],
  });

export const HELP_CATEGORY_MISSING_MESSAGE = 'カテゴリを選択してください。';

// 選択肢を表示した後にカテゴリが削除された保存も、画面が選び直しを促せるようカテゴリの欄の検証のエラーにする
export const helpCategoryMissingError = (): AppError =>
  validationError({
    field: 'categoryId',
    code: 'not-found',
    message: HELP_CATEGORY_MISSING_MESSAGE,
  });

export const helpCategoryNameRejectedError = (
  issue: CategoryNameIssue,
): AppError =>
  validationError({
    field: 'name',
    code: issue,
    message: CATEGORY_NAME_MESSAGES[issue],
  });
