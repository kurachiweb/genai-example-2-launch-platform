import {
  GUEST_NICKNAME_MAX,
  INQUIRY_BODY_MAX,
} from '../../../common-lib/inquiry/inquiry-input-rules.ts';

const countFormat = new Intl.NumberFormat('ja-JP');

export const CONTACT_PAGE_TITLE = 'お問い合わせ';

export const CONTACT_PAGE_LEAD =
  'サービスについてのご質問や不具合のご報告は、次のフォームからお送りください。';

export const CONTACT_FORM_LABEL = 'お問い合わせフォーム';

export const CATEGORY_LABEL = 'カテゴリ';

export const CATEGORY_PLACEHOLDER = '選択してください';

export const NICKNAME_LABEL = 'ニックネーム';

export const NICKNAME_DESCRIPTION = `${countFormat.format(GUEST_NICKNAME_MAX)}文字以内で入力してください。`;

export const CONTACT_EMAIL_LABEL = '連絡先メールアドレス';

export const CONTACT_EMAIL_DESCRIPTION =
  '回答をお送りする場合に使います。お間違いの無いよう入力してください。';

export const BODY_LABEL = 'メッセージ';

export const BODY_DESCRIPTION = `${countFormat.format(INQUIRY_BODY_MAX)}文字以内で入力してください。`;

export const COMPOSER_LABEL = '送信者';

export const SUBMIT_LABEL = '送信する';

export const GUEST_COMPLETE_TITLE = 'お問い合わせを受け付けました。';

export const GUEST_COMPLETE_DESCRIPTION =
  '回答は入力したメールアドレスへお送りする場合があります。';

export const SUSPENDED_CONTACT_NOTICE_LABEL = '停止中のアカウント';

export const SUSPENDED_CONTACT_NOTICE =
  'このアカウントは停止中のため、ログインしていない場合と同じフォームでお問い合わせを受け付けます。この問い合わせへの回答はサービス上では行わず、入力した連絡先メールアドレスへお送りします。';

export const RETRY_AT_SUFFIX = '以降に再度送信できます。';

export const MY_INQUIRIES_TITLE = '送信した問い合わせ';

export const MY_INQUIRIES_EMPTY_MESSAGE =
  '送信した問い合わせはまだありません。';

export const MY_INQUIRIES_PAGINATION_LABEL = `${MY_INQUIRIES_TITLE}のページ送り`;

export const SENT_AT_LABEL = '送信日時';

export const LAST_MESSAGE_AT_LABEL = '最後のメッセージ';
