import {
  HEADLINE_MAX_GRAPHEMES,
  PROFILE_WEBSITES_MAX,
  USER_HANDLE_RULE,
  WEBSITE_NAME_MAX_GRAPHEMES,
} from '../../../common-lib/profile/profile-input-rules.ts';
import { EXTERNAL_URL_MAX_LENGTH } from '../../../common-lib/url/external-url.ts';
import { ACCOUNT_FORM_MESSAGES } from '../auth/account-form-schemas.ts';

const countFormat = new Intl.NumberFormat('ja-JP');

// APIサーバーの入力の検証(apps/apiのsrc/presentation/graphql/modules/profile/errors.tsのINPUT_MESSAGESとPROFILE_ERRORSのhandle_unavailable)と同じ文言にする。一致はルートのconfig/contract-copies.unit.test.tsが確かめる
export const PROFILE_FORM_MESSAGES = Object.freeze({
  nicknameRequired: ACCOUNT_FORM_MESSAGES.nicknameRequired,
  nicknameTooLong: ACCOUNT_FORM_MESSAGES.nicknameTooLong,
  handleRequired: 'ハンドルを入力してください。',
  handleTooLong: `ハンドルは${String(USER_HANDLE_RULE.maxLength)}文字以内で入力してください。`,
  handleFormat:
    'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
  handleUnavailable:
    'このハンドルは既に使われています。別の文字列を入力してください。',
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
});

export const PROFILE_FORM_LABEL = 'プロフィールの編集';

export const AVATAR_SUBJECT_LABEL = 'プロフィール画像';

export const AVATAR_FIELD_LABEL = AVATAR_SUBJECT_LABEL;

export const AVATAR_SELECT_LABEL = '画像を選択';

export const AVATAR_REMOVE_LABEL = '画像を削除';

export const NICKNAME_FIELD_LABEL = 'ニックネーム(必須)';

export const HANDLE_FIELD_LABEL = 'ハンドル(必須)';

export const HEADLINE_FIELD_LABEL = 'ヘッドライン';

export const BIO_FIELD_LABEL = '自己紹介';

export const BIO_PLACEHOLDER = '自己紹介をマークダウンで入力してください';

export const WEBSITES_LEGEND = '外部Webサイト';

export const WEBSITE_NAME_LABEL = '名前(任意)';

export const WEBSITE_URL_LABEL = 'URL';

export const WEBSITE_REMOVE_LABEL = '削除';

export const WEBSITE_ADD_LABEL = '外部Webサイトを追加';

export const PROFILE_SAVE_LABEL = '保存';

export const websiteRowLabelOf = (position: number): string =>
  `外部Webサイト${String(position)}`;

export const websiteRemoveLabelOf = (position: number): string =>
  `${websiteRowLabelOf(position)}を${WEBSITE_REMOVE_LABEL}`;

export const previousHandleGuidanceOf = (previousHandle: string): string =>
  `以前のハンドル@${previousHandle}は、次にハンドルを変更するまで新しいURLへ転送されます。他の利用者が同じハンドルを設定すると、転送は止まります。`;

export const SUSPENDED_EDIT_NOTICE =
  'このアカウントは停止されているため、プロフィールは変更できません。';
