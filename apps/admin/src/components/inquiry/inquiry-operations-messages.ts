export const REPLY_SECTION_TITLE = '返信';

export const REPLY_BODY_LABEL = '返信の本文(必須)';

export const REPLY_BODY_DESCRIPTION =
  '1,000文字以内で入力してください。返信すると、利用者へ返信があった旨のメールが届きます(本文はメールに含まれません)。';

export const REPLY_SUBMIT_LABEL = '返信する';

export const REPLY_SENT_MESSAGE = '返信を送信しました。';

export const REPLY_NOTIFICATION_FAILED_MESSAGE =
  '返信は保存されましたが、通知メールを送れませんでした。';

export const STATUS_SECTION_TITLE = '対応ステータスの変更';

export const NEXT_STATUS_LABEL = '変更後の対応ステータス';

export const CHANGE_STATUS_LABEL = '対応ステータスを変更';

export const CHANGE_STATUS_CONFIRM_LABEL = '変更する';

export const STATUS_CHANGED_MESSAGE = '対応ステータスを変更しました。';

export const changeStatusTitle = (nextStatusLabel: string): string =>
  `対応ステータスを「${nextStatusLabel}」に変更しますか?`;

export const changeStatusDescription = (currentStatusLabel: string): string =>
  `現在の対応ステータスは「${currentStatusLabel}」です。`;
