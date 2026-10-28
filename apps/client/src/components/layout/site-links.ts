export interface SiteLink {
  readonly href: string;
  readonly label: string;
}

export const SITE_NAME = 'Launch Stadium';

export const SITE_TAGLINE =
  '1対1のマッチで競うローンチプラットフォーム。必ず半分は勝者になります。';

export const HOME_HREF = '/';

export const MAIN_NAVIGATION_LABEL = 'メイン';

export const MENU_LABEL = 'メニュー';

export const PRIMARY_NAVIGATION_LINKS: readonly SiteLink[] = Object.freeze([
  { href: '/p', label: 'ディレクトリ' },
  { href: '/help', label: 'ヘルプ' },
]);

export const LAUNCH_LINK: SiteLink = Object.freeze({
  href: '/auth/login',
  label: 'ローンチする',
});

export const LOGIN_LINK: SiteLink = Object.freeze({
  href: '/auth/login',
  label: 'ログイン',
});

export const REGISTER_LINK: SiteLink = Object.freeze({
  href: '/auth/register',
  label: '登録',
});

export const FOOTER_HELP_NAVIGATION_LABEL = 'ヘルプ';

export const FOOTER_HELP_TOP_LINK: SiteLink = Object.freeze({
  href: '/help',
  label: 'ヘルプ',
});

export const FOOTER_POLICY_NAVIGATION_LABEL = '規約・問い合わせ';

export const FOOTER_POLICY_LINKS: readonly SiteLink[] = Object.freeze([
  { href: '/terms', label: '利用規約' },
  { href: '/privacy', label: 'プライバシーポリシー' },
  { href: '/legal', label: '法的通知' },
  { href: '/pricing', label: '料金' },
  { href: '/contact', label: 'お問い合わせ' },
]);
