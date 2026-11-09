import {
  PRODUCT_SCREENSHOTS_MAX,
  PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES,
} from '../../../common-lib/product/product-input-rules.ts';
import {
  type DateTimeFormatName,
  formatDateTime,
} from '../../../lib/utilities/datetime/date-time-formats.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { formatRemaining } from '../../../lib/utilities/datetime/relative-time.ts';
import { formatFileSize } from '../../../lib/utilities/media/file-size-label.ts';
import { PROFILE_FORM_MESSAGES } from '../profile/profile-form-messages.ts';
import { yearInTimeZone } from './launch-date-format.ts';

// APIサーバーの入力の検証(apps/apiのsrc/presentation/graphql/modules/product/errors.tsのINPUT_MESSAGES)と保存の拒否(src/application/product/product-errors.tsのhandle_unavailable)と同じ文言にする。一致はルートのconfig/contract-copies.unit.test.tsが確かめる
export const PRODUCT_FORM_MESSAGES = Object.freeze({
  handleUnavailable:
    'このハンドルは既に使われています。別の文字列を入力してください。',
  websiteUrlRequired: PROFILE_FORM_MESSAGES.websiteUrlRequired,
  websiteUrlTooLong: PROFILE_FORM_MESSAGES.websiteUrlTooLong,
  websiteUrlFormat: PROFILE_FORM_MESSAGES.websiteUrlFormat,
  screenshotsTooMany: `スクリーンショットは${String(PRODUCT_SCREENSHOTS_MAX)}枚・合計${formatFileSize(PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES)}以内にしてください。`,
  launchDateRequired: 'ローンチ日を選んでください。',
});

// 画面の操作の誤りだけを示す文言。APIサーバーはカテゴリの未選択を不在のカテゴリとして、ロゴの未設定をGraphQLの型の違反として拒否する
export const CATEGORY_REQUIRED_MESSAGE = 'カテゴリを選択してください。';

export const LOGO_REQUIRED_MESSAGE = 'ロゴを選択してください。';

export const PRODUCT_REGISTER_PAGE_TITLE = 'プロダクトを登録';

export const BASIC_SECTION_HEADING = '基本情報';

export const DESCRIPTION_SECTION_HEADING = '説明文';

export const SCREENSHOTS_SECTION_HEADING = 'スクリーンショット';

export const LAUNCH_DATE_SECTION_HEADING = 'ローンチ日';

export const NAME_FIELD_LABEL = '名称(必須)';

export const TAGLINE_FIELD_LABEL = 'タグライン(必須)';

export const WEBSITE_URL_FIELD_LABEL = '外部WebサイトURL(必須)';

export const DESCRIPTION_FIELD_LABEL = '説明文(必須)';

export const DESCRIPTION_PLACEHOLDER = '説明文をマークダウンで入力してください';

export const REGISTER_SUBMIT_LABEL = 'ローンチを予約';

// 絵文字は支援技術に読ませず、見た目の文字としてだけ添える
export const REGISTER_SUBMIT_EMOJI = '🚀';

export const EDIT_SUBMIT_LABEL = '変更を保存';

export const EMAIL_VERIFICATION_REQUIRED_NOTICE =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

// 文言規則のキックオフの日時の表示と同じく、今年(利用者のタイムゾーン)の日時は年を省き、残りの相対表現を括弧で添える
export const productRegisteredMessageOf = (
  kickoffAt: string,
  preferences: DisplayPreferences,
  now: Date,
): string => {
  const kickoff = new Date(kickoffAt);
  const format: DateTimeFormatName =
    yearInTimeZone(kickoff, preferences.timeZone) ===
    yearInTimeZone(now, preferences.timeZone)
      ? 'dateTime'
      : 'longDateTime';
  return `プロダクトを登録しました。キックオフは${formatDateTime(kickoff, format, preferences)}(${formatRemaining(kickoff, now)})です。`;
};

export const LOGO_FIELD_LABEL = 'ロゴ(必須)';

export const LOGO_SUBJECT_LABEL = 'ロゴ';

export const LOGO_SELECT_LABEL = '画像を選択';

export const LOGO_REPLACE_LABEL = 'ロゴを差し替え';

export const CATEGORY_FIELD_LABEL = 'カテゴリ(必須)';

export const CATEGORY_PLACEHOLDER = '選択してください';

export const PRODUCT_HANDLE_FIELD_LABEL = 'ハンドル(必須)';

export const PRODUCT_HANDLE_PREFIX = '/p/';

export const previousProductHandleGuidanceOf = (
  previousHandle: string,
): string =>
  `以前のハンドル${previousHandle}は、次にハンドルを変更するか他のプロダクトが同じハンドルを設定するまで、新しいURLへ転送されます。`;

export const SCREENSHOTS_FIELD_LABEL = 'スクリーンショット';

export const SCREENSHOT_SUBJECT_LABEL = 'スクリーンショット';

export const SCREENSHOTS_SELECT_LABEL = '画像を選択';

export const SCREENSHOT_REMOVE_LABEL = '取り除く';

export const screenshotAltOf = (position: number): string =>
  `スクリーンショット${String(position)}`;

export const screenshotRemoveLabelOf = (position: number): string =>
  `${screenshotAltOf(position)}を${SCREENSHOT_REMOVE_LABEL}`;

export const screenshotTotalsOf = (count: number, totalBytes: number): string =>
  `${String(count)}/${String(PRODUCT_SCREENSHOTS_MAX)}枚・${formatFileSize(totalBytes)}/${formatFileSize(PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES)}`;

export const LAUNCH_DATE_FIELD_LABEL = 'ローンチ日(必須)';
