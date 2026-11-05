import { CHAT_MESSAGE_MAX } from '../../../common-lib/inquiry/inquiry-input-rules.ts';

const countFormat = new Intl.NumberFormat('ja-JP');

export const INQUIRY_CHAT_PAGE_TITLE = '問い合わせチャット';

export const INQUIRY_STATUS_LABEL = '対応ステータス';

export const INQUIRY_MESSAGES_TITLE = 'メッセージ';

export const DELETED_ADMIN_LABEL = '削除済みの管理者';

export const INQUIRY_MESSAGE_FORM_LABEL = 'メッセージの送信フォーム';

export const INQUIRY_MESSAGE_DESCRIPTION = `${countFormat.format(CHAT_MESSAGE_MAX)}文字以内で入力してください。`;

export const SUSPENDED_CHAT_NOTICE_PREFIX =
  'このアカウントは停止中のため、メッセージを送信できません。運営への連絡は';

export const SUSPENDED_CHAT_NOTICE_LINK = 'お問い合わせフォーム';

export const SUSPENDED_CHAT_NOTICE_SUFFIX = 'から行えます。';

export const INQUIRY_NOT_FOUND_MESSAGE = '問い合わせが見つかりません。';

export const INQUIRY_NOT_FOUND_DESCRIPTION =
  '送信した問い合わせは、お問い合わせのページの一覧から開けます。';

export const BACK_TO_CONTACT_LABEL = 'お問い合わせのページへ';
