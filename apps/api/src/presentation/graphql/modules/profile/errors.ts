import {
  HEADLINE_MAX_GRAPHEMES,
  USER_HANDLE_RULE,
  WEBSITE_NAME_MAX_GRAPHEMES,
  PROFILE_WEBSITES_MAX,
} from '../../../../../common-lib/profile/profile-input-rules.ts';
import { EXTERNAL_URL_MAX_LENGTH } from '../../../../../common-lib/url/external-url.ts';
import type { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';
import { PROFILE_ERRORS } from '../../../../application/profile/profile-errors.ts';
import { INPUT_MESSAGES as IDENTITY_INPUT_MESSAGES } from '../identity/errors.ts';

const countFormat = new Intl.NumberFormat('ja-JP');

// 入力の検証の失敗(validation_error)の欄ごとの文言。ユースケースが投げるエラーの文言はapplication層のprofile-errors.tsにある
export const INPUT_MESSAGES = Object.freeze({
  nicknameRequired: IDENTITY_INPUT_MESSAGES.nicknameRequired,
  nicknameTooLong: IDENTITY_INPUT_MESSAGES.nicknameTooLong,
  handleRequired: 'ハンドルを入力してください。',
  handleTooLong: `ハンドルは${String(USER_HANDLE_RULE.maxLength)}文字以内で入力してください。`,
  handleFormat:
    'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
  headlineForbiddenCharacters:
    'ヘッドラインに使用できない文字が含まれています。',
  headlineTooLong: `ヘッドラインは${String(HEADLINE_MAX_GRAPHEMES)}文字以内で入力してください。`,
  websitesTooMany: `外部Webサイトは${String(PROFILE_WEBSITES_MAX)}件以内で入力してください。`,
  websiteNameForbiddenCharacters:
    '外部Webサイトの名前に使用できない文字が含まれています。',
  websiteNameTooLong: `外部Webサイトの名前は${String(WEBSITE_NAME_MAX_GRAPHEMES)}文字以内で入力してください。`,
  websiteUrlRequired: '外部WebサイトのURLを入力してください。',
  websiteUrlTooLong: `外部WebサイトURLは${countFormat.format(EXTERNAL_URL_MAX_LENGTH)}文字以内で入力してください。`,
  websiteUrlFormat:
    '外部WebサイトURLは"https://"または"http://"から始まるURLを入力してください。',
  avatarInvalid: PROFILE_ERRORS.invalid_upload.message,
});

// GraphQLの引数の名前。検証の詳細の欄と同じく、ユースケースが返す詳細の欄もこの下の経路で示す
export const INPUT_ARGUMENT = 'input';

export const callerForbiddenError = (): AppError => authError('forbidden');
