import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import {
  MODERATION_ERRORS,
  moderationError,
} from '../../../../application/moderation/moderation-errors.ts';
import { PRODUCT_ERRORS } from '../../../../application/product/product-errors.ts';

// 措置と照会のユースケースが投げるコードと文言はmoderation-errors.tsにあり、ここでは引数の形式の違反の文言と上流のエラーの写像だけを持つ

// 画面の操作では形式の違うIDを送らないため、存在しない対象と同じ文言を示す
export const USER_ID_INVALID_MESSAGE = MODERATION_ERRORS.user_not_found.message;

export const PRODUCT_ID_INVALID_MESSAGE =
  MODERATION_ERRORS.product_not_found.message;

export const COMMENT_ID_INVALID_MESSAGE =
  MODERATION_ERRORS.comment_not_found.message;

export const RATING_ID_INVALID_MESSAGE =
  MODERATION_ERRORS.rating_not_found.message;

export const IMAGE_ID_INVALID_MESSAGE =
  MODERATION_ERRORS.image_not_found.message;

// 存在しないカテゴリの絞り込みは空の一覧になるため、プロダクトのカテゴリの選び直しを求める文言を示す
export const CATEGORY_ID_INVALID_MESSAGE =
  PRODUCT_ERRORS.category_not_found.message;

// 画像用でない用途のファイルの個別の隔離は、要件の「画像用の用途でない」に当たるため画像が見つからない扱いにする。利用者本人の操作の競合と同じコードの上流のエラーは、管理画面では読み直しを案内する文言へ差し替える
export const toModerationError = (error: unknown): unknown => {
  if (!(error instanceof AppError)) {
    return error;
  }
  if (error.code === 'quarantine_not_applicable') {
    return moderationError('image_not_found');
  }
  if (
    error.code === 'account_state_conflict' &&
    error.message !== MODERATION_ERRORS.account_state_conflict.message
  ) {
    return moderationError('account_state_conflict');
  }
  return error;
};
