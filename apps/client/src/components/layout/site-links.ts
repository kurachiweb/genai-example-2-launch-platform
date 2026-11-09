import {
  LEGAL_DOCUMENT_KINDS,
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_PATHS,
  type LegalDocumentPath,
} from '../../../common-lib/legal/legal-documents.ts';

export interface SiteLink {
  readonly href: string;
  readonly label: string;
}

export const SITE_NAME = 'Launch Stadium';

export const SITE_TAGLINE =
  '1対1のマッチで競うローンチプラットフォーム。必ず半分は勝者になります。';

export const HOME_HREF = '/';

export const DIRECTORY_HREF = '/p';

export const CONTACT_HREF = '/contact';

export const PRICING_HREF = '/pricing';

export const TERMS_HREF = LEGAL_DOCUMENT_PATHS.terms;

export const PRIVACY_HREF = LEGAL_DOCUMENT_PATHS.privacy;

export const MAIN_NAVIGATION_LABEL = 'メイン';

export const MENU_LABEL = 'メニュー';

export const PRIMARY_NAVIGATION_LINKS: readonly SiteLink[] = Object.freeze([
  { href: DIRECTORY_HREF, label: 'ディレクトリ' },
  { href: '/help', label: 'ヘルプ' },
]);

export const LAUNCH_LABEL = 'ローンチする';

export const NEW_PRODUCT_HREF = '/my/products/new';

export const myProductEditHref = (productHandle: string): string =>
  `/my/products/${productHandle}/edit`;

export const productDetailHref = (productHandle: string): string =>
  `${DIRECTORY_HREF}/${productHandle}`;

// 他の条件を付けずに、ディレクトリをそのカテゴリで絞り込む
export const directoryCategoryHref = (categoryHandle: string): string =>
  `${DIRECTORY_HREF}?${new URLSearchParams({ category: categoryHandle }).toString()}`;

export const PROFILE_LABEL = 'プロフィール';

export const profileHref = (handle: string): string => `/@${handle}`;

export const MY_PRODUCTS_LINK: SiteLink = Object.freeze({
  href: '/my/products',
  label: '自身のプロダクト',
});

export const SETTINGS_LINK: SiteLink = Object.freeze({
  href: '/settings',
  label: '設定',
});

export const LOGOUT_LABEL = 'ログアウト';

export const userMenuLabel = (nickname: string): string =>
  `${nickname}のユーザーメニュー`;

export const FOOTER_HELP_NAVIGATION_LABEL = 'ヘルプ';

export const FOOTER_HELP_TOP_LINK: SiteLink = Object.freeze({
  href: '/help',
  label: 'ヘルプ',
});

export const FOOTER_POLICY_NAVIGATION_LABEL = '規約・問い合わせ';

export interface LegalDocumentSiteLink {
  readonly to: LegalDocumentPath;
  readonly label: string;
}

export const FOOTER_LEGAL_DOCUMENT_LINKS: readonly LegalDocumentSiteLink[] =
  Object.freeze(
    LEGAL_DOCUMENT_KINDS.map((kind) => ({
      to: LEGAL_DOCUMENT_PATHS[kind],
      label: LEGAL_DOCUMENT_LABELS[kind],
    })),
  );

export const FOOTER_POLICY_LINKS: readonly SiteLink[] = Object.freeze([
  { href: PRICING_HREF, label: '料金' },
  { href: CONTACT_HREF, label: 'お問い合わせ' },
]);
