// apps/apiのsrc/presentation/graphql/modules/identity/resolver-support.tsのBOT_ACTIONS(APIサーバーがbot判定の結果と照合する操作名)の写し。一致はルートのconfig/contract-copies.unit.test.tsが確かめる
export const BOT_ACTIONS = Object.freeze({
  register: 'register',
  login: 'login',
  passwordReset: 'password_reset',
  emailChange: 'email_change',
  passwordChange: 'password_change',
  withdraw: 'withdraw',
});
