export interface AdminNavItem {
  readonly to: string;
  readonly label: string;
  // ページ配置の16メニューの順(ダッシュボード10・ユーザー20・プロダクト30・コメント40・評価50・画像モデレーション60・通報70・問い合わせ80・スポンサー広告90・ヘルプ記事100・カテゴリ110・法務文書120・設定130・管理者アカウント140・監査ログ150・自分のアカウント160)
  readonly order: number;
}

// 管理画面のメニューに並べる項目の登録箇所。各specが自分の画面のURLとorderで項目を追記する。全ロールが全メニューを参照できるため、項目はロールで隠さない
export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = Object.freeze([
  { to: '/', label: 'ダッシュボード', order: 10 },
  { to: '/inquiries', label: '問い合わせ', order: 80 },
  { to: '/help-articles', label: 'ヘルプ記事', order: 100 },
  { to: '/categories', label: 'カテゴリ', order: 110 },
  { to: '/legal-documents', label: '法務文書', order: 120 },
  { to: '/settings', label: '設定', order: 130 },
  { to: '/accounts', label: '管理者アカウント', order: 140 },
  { to: '/audit-logs', label: '監査ログ', order: 150 },
  { to: '/account', label: '自分のアカウント', order: 160 },
]);
