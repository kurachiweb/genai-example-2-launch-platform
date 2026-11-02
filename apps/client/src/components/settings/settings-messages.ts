export const SETTINGS_NAVIGATION_LABEL = '設定';

export const ACCOUNT_SETTINGS_PAGE_TITLE = 'アカウント';

export const NEW_EMAIL_LABEL = '新しいメールアドレス';

export const CURRENT_PASSWORD_LABEL = '現在のパスワード';

export const REAUTHENTICATION_LEGEND = '本人確認';

export const EMAIL_CHANGE_SECTION_DESCRIPTION =
  '新しいメールアドレスに確認のリンクを送信します。リンクの画面で確定すると、メールアドレスが変わります。';

export const EMAIL_CHANGE_SUBMIT_LABEL = 'メールアドレスを変更する';

export const EMAIL_CHANGE_REQUESTED_MESSAGE =
  '入力したメールアドレスが他のアカウントで使われていない場合は、確認のリンクを送信しました。リンクの有効期限は24時間です。';

export const PASSWORD_CHANGE_SECTION_DESCRIPTION =
  '現在のメールアドレスに確認のリンクを送信します。リンクの画面で確定すると、パスワードが変わります。';

export const PASSWORD_CHANGE_SUBMIT_LABEL = 'パスワードを変更する';

export const PASSWORD_CHANGE_REQUESTED_MESSAGE =
  '現在のメールアドレスに確認のリンクを送信しました。リンクの有効期限は30分です。リンクの画面で確定するまで、パスワードは変わりません。';

export const WITHDRAWAL_SECTION_TITLE = '退会';

export const WITHDRAWAL_IMPACTS: readonly string[] = Object.freeze([
  '退会は取り消せません。',
  '投稿したプロダクト・コメント・評価と、Upvote・フォローは、退会と同時に表示されなくなります。',
  'Ultrasなどの定期課金は、返金せずに直ちに解約されます。',
  '個人データは、退会から14日以内に削除されます。',
]);

export const WITHDRAWAL_ACTION_LABEL = '退会する';

export const WITHDRAWAL_CONFIRM_TITLE = '退会しますか?';

export const WITHDRAWAL_CONFIRM_DESCRIPTION =
  '退会すると、次のとおりになります。続けるには、本人確認の入力をしてください。';

export const CANCEL_LABEL = 'キャンセル';

export const WITHDRAWN_MESSAGE = '退会しました。';

export const SUSPENDED_NOTICE_LABEL = '停止中のアカウント';

export const SUSPENDED_NOTICE_PREFIX =
  'このアカウントは停止されているため、メールアドレスとパスワードは変更できません。退会はこの画面から行えます。ログアウトした後やログインの有効期限が切れた後は、';

export const CONTACT_LINK_LABEL = 'お問い合わせ';

export const SUSPENDED_NOTICE_SUFFIX = 'から退会を依頼できます。';
