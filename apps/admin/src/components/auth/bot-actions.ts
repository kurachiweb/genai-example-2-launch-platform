// apps/apiのsrc/presentation/graphql/modules/admin/resolver-support.tsのADMIN_BOT_ACTIONS(APIサーバーがbot判定の結果と照合する管理者側の操作名)の写し。一致はルートのconfig/contract-copies.unit.test.tsが確かめる
export const ADMIN_BOT_ACTIONS = Object.freeze({
  login: 'admin_login',
  passwordReset: 'admin_password_reset',
});
