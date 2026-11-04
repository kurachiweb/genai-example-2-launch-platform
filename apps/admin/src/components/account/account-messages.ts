export const ACCOUNT_PAGE_TITLE = '自分のアカウント';

export const ACCOUNT_PAGE_DESCRIPTION =
  'プロフィールと、ログインに使うメールアドレス・パスワード・多要素認証を変更します。';

export const PROFILE_SECTION_TITLE = 'プロフィール';

export const PROFILE_SECTION_DESCRIPTION =
  'ニックネーム・肩書き・プロフィール画像は、問い合わせの返信などで利用者にも表示されます。';

export const REAUTHENTICATION_LEGEND = '本人確認';

export const CURRENT_PASSWORD_LABEL = '現在のパスワード';

export const EMAIL_CHANGE_SECTION_TITLE = 'メールアドレスの変更';

export const EMAIL_CHANGE_SECTION_DESCRIPTION =
  '新しいメールアドレスに確認のリンクを送信します。リンクの画面で確定すると、メールアドレスが変わり、ほかの端末ではログアウトします。';

export const currentEmailText = (email: string): string =>
  `現在のメールアドレス: ${email}`;

export const NEW_EMAIL_LABEL = '新しいメールアドレス';

export const EMAIL_CHANGE_SUBMIT_LABEL = '確認のリンクを送信する';

export const EMAIL_CHANGE_REQUESTED_MESSAGE =
  '入力したメールアドレスがほかの管理者に使われていない場合は、確認のリンクを送信しました。リンクの有効期限は24時間です。';

export const PASSWORD_CHANGE_SECTION_TITLE = 'パスワードの変更';

export const PASSWORD_CHANGE_SECTION_DESCRIPTION =
  'パスワードはすぐに変わり、ほかの端末ではログアウトします。';

export const PASSWORD_CHANGE_SUBMIT_LABEL = 'パスワードを変更する';

export const PASSWORD_CHANGED_MESSAGE =
  'パスワードを変更しました。ほかの端末ではログアウトしました。';

export const TOTP_SECTION_TITLE = '多要素認証';

export const TOTP_SECTION_DESCRIPTION =
  '認証アプリの端末を替える時に設定し直します。設定し直すまでは、今の認証アプリの認証コードを使えます。多要素認証は無効にできません。';

export const TOTP_RESET_LABEL = '多要素認証の再設定';

export const TOTP_RESET_START_LABEL = '再設定を始める';

export const TOTP_RESET_SUBMIT_LABEL = '再設定を完了する';

export const TOTP_RESET_COMPLETED_MESSAGE =
  '多要素認証を設定し直しました。ほかの端末ではログアウトしました。';

export const RECOVERY_CODE_SECTION_TITLE = 'リカバリコード';

export const RECOVERY_CODE_SECTION_DESCRIPTION =
  '認証アプリを使えない時に、認証コードの代わりに入力します。再発行すると未使用のリカバリコードは使えなくなり、ほかの端末ではログアウトします。';

export const remainingRecoveryCodesMessage = (count: number): string =>
  `未使用のリカバリコードは残り${String(count)}個です。`;

export const RECOVERY_CODES_LOW_MESSAGE =
  '残りが少なくなっています。リカバリコードを再発行してください。';

export const RECOVERY_CODE_REGENERATE_LABEL = 'リカバリコードの再発行';

export const RECOVERY_CODE_REGENERATE_SUBMIT_LABEL =
  'リカバリコードを再発行する';

export const RECOVERY_CODES_DIALOG_TITLE = '新しいリカバリコード';

export const RECOVERY_CODES_DIALOG_DESCRIPTION =
  '以前のリカバリコードは使えなくなり、ほかの端末ではログアウトしました。新しいリカバリコードは、この画面でだけ表示されます。';
