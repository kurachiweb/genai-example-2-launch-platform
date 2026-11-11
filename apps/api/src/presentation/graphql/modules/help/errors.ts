import type { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';
import { HELP_ERRORS } from '../../../../application/help/help-errors.ts';

// 入力の検証の失敗(validation_error)の欄ごとの文言。カテゴリ名の文言は共用部品の入力規則、ユースケースが投げるエラーの文言はapplication層のhelp-errors.tsにある
export const INPUT_MESSAGES = Object.freeze({
  categoryNotFound: HELP_ERRORS.help_category_not_found.message,
  // 空・重複・上限超過の並びは画面の操作では起きず、表示中の並びが最新でない時と同じく読み込み直しを促す
  orderInvalid: HELP_ERRORS.help_order_outdated.message,
});

export const callerForbiddenError = (): AppError => authError('forbidden');
