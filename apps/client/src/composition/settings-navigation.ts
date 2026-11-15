export interface SettingsNavItem {
  readonly to: string;
  readonly label: string;
  // ページ配置の表の順(profile 10・account 20・security 30・notifications 40・follows 50・plan 60・billing 70・sponsorships 80・api-keys 90・export 100)
  readonly order: number;
}

// 設定ページのナビゲーションに並べる項目の登録箇所。各specが`/settings/<名前>`の項目を追記する
export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = Object.freeze([
  { to: '/settings/profile', label: 'プロフィール', order: 10 },
  { to: '/settings/account', label: 'アカウント', order: 20 },
  { to: '/settings/security', label: 'セキュリティ', order: 30 },
  { to: '/settings/follows', label: 'フォロー', order: 50 },
  { to: '/settings/plan', label: 'プラン', order: 60 },
  { to: '/settings/billing', label: '決済履歴', order: 70 },
]);
