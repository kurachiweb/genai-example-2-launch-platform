import type { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';
import { PRODUCT_ERRORS } from '../../../../application/product/product-errors.ts';
import { INPUT_MESSAGES as PROFILE_INPUT_MESSAGES } from '../profile/errors.ts';

// 入力の検証の失敗(validation_error)の欄ごとの文言。名称・タグライン・ハンドルの文言は共用部品の入力規則が持ち、ユースケースが投げるエラーの文言はapplication層のproduct-errors.tsにある
export const INPUT_MESSAGES = Object.freeze({
  websiteUrlRequired: PROFILE_INPUT_MESSAGES.websiteUrlRequired,
  websiteUrlTooLong: PROFILE_INPUT_MESSAGES.websiteUrlTooLong,
  websiteUrlFormat: PROFILE_INPUT_MESSAGES.websiteUrlFormat,
  categoryInvalid: PRODUCT_ERRORS.category_not_found.message,
  imageInvalid: PRODUCT_ERRORS.invalid_upload.message,
  screenshotsTooMany: PRODUCT_ERRORS.screenshot_limit_exceeded.message,
  launchDateRequired: 'ローンチ日を選んでください。',
});

// GraphQLの引数の名前。検証の詳細の欄と同じく、ユースケースが返す詳細の欄もこの下の経路で示す
export const INPUT_ARGUMENT = 'input';

export const callerForbiddenError = (): AppError => authError('forbidden');
