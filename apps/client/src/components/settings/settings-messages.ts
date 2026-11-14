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

export const SUSPENDED_ACCOUNT_NOTICE_LEAD =
  'このアカウントは停止されているため、メールアドレスとパスワードは変更できません。退会はこの画面から行えます。';

export const SUSPENDED_NOTICE_PREFIX =
  'ログアウトした後やログインの有効期限が切れた後は、';

export const CONTACT_LINK_LABEL = 'お問い合わせ';

export const SUSPENDED_NOTICE_SUFFIX = 'から退会を依頼できます。';

export const SECURITY_SETTINGS_PAGE_TITLE = 'セキュリティ';

export const SUSPENDED_SECURITY_NOTICE_LEAD =
  'このアカウントは停止されているため、多要素認証の設定は変更できません。ログイン中の端末のログアウトは行えます。退会はアカウントの設定ページから行えます。';

export const SESSIONS_SECTION_TITLE = 'ログイン中の端末';

export const SESSIONS_SECTION_DESCRIPTION =
  '心当たりの無い端末があれば、ログアウトさせてから、パスワードを変更してください。';

export const sessionCountMessage = (count: number): string =>
  `${String(count)}台の端末でログインしています。`;

export const UNKNOWN_DEVICE_LABEL = '不明な端末';

export const CURRENT_DEVICE_LABEL = 'この端末';

export const LAST_USED_AT_LABEL = '最終利用';

export const SIGNED_IN_AT_LABEL = 'ログインした日時';

export const REVOKE_SESSION_LABEL = 'ログアウトさせる';

export const REVOKE_SESSION_PENDING_LABEL = 'ログアウトさせています';

export const SESSION_REVOKED_MESSAGE = '端末をログアウトさせました。';

export const REVOKE_OTHER_SESSIONS_LABEL = 'この端末以外をすべてログアウト';

export const REVOKE_OTHER_SESSIONS_CONFIRM_TITLE =
  'この端末以外をすべてログアウトしますか?';

export const REVOKE_OTHER_SESSIONS_CONFIRM_DESCRIPTION =
  'この端末以外のすべての端末で、再度のログインが必要になります。';

export const REVOKE_OTHER_SESSIONS_CONFIRM_LABEL = 'すべてログアウト';

export const otherSessionsRevokedMessage = (count: number): string =>
  `${String(count)}台の端末をログアウトさせました。`;

export const TOTP_SECTION_TITLE = '多要素認証';

export const TOTP_SECTION_DESCRIPTION =
  'ログインの時に、パスワードに加えて認証アプリに表示される6桁の認証コードを求めます。';

export const TOTP_ENABLED_STATUS = '多要素認証は有効です。';

export const TOTP_DISABLED_STATUS = '多要素認証は無効です。';

export const TOTP_START_FORM_LABEL = '多要素認証の設定';

export const TOTP_START_SUBMIT_LABEL = '設定を始める';

export const TOTP_SETUP_DIALOG_TITLE = '多要素認証の設定';

export const TOTP_SETUP_DIALOG_DESCRIPTION =
  '認証アプリでQRコードを読み取り、表示された6桁の認証コードを入力してください。';

export const TOTP_MANUAL_ENTRY_LABEL =
  'QRコードを読み取れない場合は、次の文字列を認証アプリに入力してください。';

export const TOTP_SETUP_EXPIRES_PREFIX = 'この設定は';

export const TOTP_SETUP_EXPIRES_SUFFIX =
  'まで有効です。過ぎた場合は、最初からやり直してください。';

export const TOTP_ENABLE_SUBMIT_LABEL = '有効にする';

export const TOTP_ENABLED_MESSAGE = '多要素認証を有効にしました。';

export const RECOVERY_CODES_SHOWN_ONCE_MESSAGE =
  '次のリカバリコードは、この画面でだけ表示されます。認証アプリを使えない時に、認証コードの代わりに入力します。';

export const TOTP_DISABLE_FORM_LABEL = '多要素認証の無効化';

export const TOTP_DISABLE_SUBMIT_LABEL = '多要素認証を無効にする';

export const TOTP_DISABLED_MESSAGE = '多要素認証を無効にしました。';

export const RECOVERY_CODE_SECTION_TITLE = 'リカバリコード';

export const RECOVERY_CODE_SECTION_DESCRIPTION =
  '認証アプリを使えない時に、認証コードの代わりに1回だけ使えるコードです。再発行すると、以前のリカバリコードは使えなくなります。';

export const remainingRecoveryCodesMessage = (count: number): string =>
  `未使用のリカバリコードは残り${String(count)}個です。`;

export const RECOVERY_CODES_LOW_MESSAGE =
  '残りが少なくなっています。リカバリコードを再発行してください。';

export const RECOVERY_CODE_REGENERATE_FORM_LABEL = 'リカバリコードの再発行';

export const RECOVERY_CODE_REGENERATE_SUBMIT_LABEL =
  'リカバリコードを再発行する';

export const RECOVERY_CODES_DIALOG_TITLE = '新しいリカバリコード';

export const RECOVERY_CODES_DIALOG_DESCRIPTION =
  '以前のリカバリコードは使えなくなりました。新しいリカバリコードは、この画面でだけ表示されます。';
