import {
  SENDER_INFO_MAX_GRAPHEMES,
  type SenderInfoField,
} from '../../../common-lib/notifications/sender-info-input-rules.ts';

export const SENDER_INFO_TITLE = '通知メールの送信者情報';

export const SENDER_INFO_DESCRIPTION = `全てのメールの末尾に表示します。各${String(SENDER_INFO_MAX_GRAPHEMES)}文字以内で入力してください。`;

export const SENDER_INFO_UNSET_WARNING =
  '送信者情報が未設定のため、通知メールを送信していません。';

export const SENDER_INFO_UPDATED_AT_LABEL = '最後に変更した日時';

export const SENDER_INFO_UPDATED_BY_LABEL = '変更した管理者';

export const SENDER_INFO_NONE_LABEL = 'なし';

export const SENDER_INFO_READ_ONLY_NOTICE = '最上位管理者だけが変更できます。';

export const SENDER_INFO_SUBMIT_LABEL = '保存する';

export const SENDER_INFO_CONFIRM_TITLE =
  '通知メールの送信者情報を保存しますか?';

export const SENDER_INFO_CONFIRM_DESCRIPTION =
  '保存した内容は、以後に送る全てのメールの末尾に表示されます。';

export const SENDER_INFO_CONFIRM_LABEL = '保存する';

export const SENDER_INFO_SAVED_MESSAGE = '送信者情報を保存しました。';

export const SENDER_INFO_EMAIL_FORMAT_MESSAGE =
  'メールアドレスの形式が正しくありません。';

export const SENDER_INFO_FIELD_NAMES: Readonly<
  Record<SenderInfoField, string>
> = Object.freeze({
  businessName: '事業者名',
  contactEmail: '連絡先メールアドレス',
  postalAddress: '物理的郵送先住所',
});

export const senderInfoFieldLabelOf = (field: SenderInfoField): string =>
  `${SENDER_INFO_FIELD_NAMES[field]}(必須)`;

export const senderInfoRequiredMessageOf = (field: SenderInfoField): string =>
  `${SENDER_INFO_FIELD_NAMES[field]}を入力してください。`;

export const senderInfoTooLongMessageOf = (field: SenderInfoField): string =>
  `${SENDER_INFO_FIELD_NAMES[field]}は${String(SENDER_INFO_MAX_GRAPHEMES)}文字以内で入力してください。`;
