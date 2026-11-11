import {
  type WebAnalyticsHeadScript,
  webAnalyticsHeadScript,
} from '../../lib/start/observability/web-analytics.ts';
import { buildPageHead } from '../../lib/start/page-head.ts';
import {
  LEGAL_DOCUMENT_LABELS,
  type LegalDocumentKind,
  legalVersionTitle,
} from '../../common-lib/legal/legal-documents.ts';
import {
  DIRECTORY_PAGE_DESCRIPTION,
  DIRECTORY_PAGE_TITLE,
} from '../components/directory/directory-page-messages.ts';
import { HELP_TOP_TITLE } from '../components/help/help-messages.ts';
import { INQUIRY_CHAT_PAGE_TITLE } from '../components/inquiry/inquiry-chat-messages.ts';
import { CONTACT_PAGE_TITLE } from '../components/inquiry/inquiry-contact-messages.ts';
import {
  CHECKOUT_PAGE_TITLE,
  CHECKOUT_RETURN_PAGE_TITLE,
} from '../components/payments/checkout-messages.ts';
import {
  CONTACT_HREF,
  DIRECTORY_HREF,
  HELP_TOP_HREF,
  productDetailHref,
  profileHref,
  SITE_NAME,
} from '../components/layout/site-links.ts';
import {
  PRICING_PAGE_DESCRIPTION,
  PRICING_PAGE_TITLE,
} from '../components/ultras/pricing-messages.ts';
import { PRICING_PAGE_HREF } from '../components/ultras/ultras-messages.ts';
import type {
  LegalDocumentLoaderData,
  LegalVersionLoaderData,
} from '../graphql/legal-documents.ts';
import type { ProductPageLoaderData } from '../graphql/product-page.ts';
import type { PublicProfileLoaderData } from '../graphql/public-profile.ts';

export interface RootHeadInput {
  readonly stylesheetHref: string;
  readonly webAnalyticsToken: string | undefined;
}

export interface SitePageHeadInput {
  readonly title: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
  readonly noIndex?: boolean;
}

// TanStack Routerのheadは書き換え可能な配列を求めるため、凍結された配列を広げて新しい配列で返す
export const buildSitePageHead = ({
  title,
  description,
  canonicalUrl,
  noIndex,
}: SitePageHeadInput) => {
  const head = buildPageHead({
    title,
    siteName: SITE_NAME,
    ...(description === undefined ? {} : { description }),
    ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
    ...(noIndex === undefined ? {} : { noIndex }),
  });
  return { meta: [...head.meta], links: [...head.links] };
};

// 準備中の文書は内容が無いため、検索の索引の対象外にし、索引に載せる正規のURLも付けない
export const buildLegalDocumentHead = (
  kind: LegalDocumentKind,
  loaderData: LegalDocumentLoaderData | undefined,
) =>
  buildSitePageHead({
    title: LEGAL_DOCUMENT_LABELS[kind],
    ...(loaderData === undefined
      ? {}
      : loaderData.preparing
        ? { noIndex: true }
        : { canonicalUrl: loaderData.canonicalUrl }),
  });

export const buildLegalVersionHead = (
  kind: LegalDocumentKind,
  loaderData: LegalVersionLoaderData | undefined,
) =>
  buildSitePageHead({
    title:
      loaderData === undefined
        ? LEGAL_DOCUMENT_LABELS[kind]
        : legalVersionTitle(
            LEGAL_DOCUMENT_LABELS[kind],
            loaderData.versionNumber,
          ),
    noIndex: true,
  });

export const buildContactHead = () =>
  buildSitePageHead({ title: CONTACT_PAGE_TITLE, canonicalUrl: CONTACT_HREF });

// 未ログインでも閲覧できる公開のページのため、検索エンジン向けの説明と正規のURLを付ける
export const buildPricingHead = () =>
  buildSitePageHead({
    title: PRICING_PAGE_TITLE,
    description: PRICING_PAGE_DESCRIPTION,
    canonicalUrl: PRICING_PAGE_HREF,
  });

// 条件ごとのURLは同じ一覧の並べ替え・絞り込みのため、正規のURLは条件を含まないディレクトリにする
export const buildDirectoryHead = () =>
  buildSitePageHead({
    title: DIRECTORY_PAGE_TITLE,
    description: DIRECTORY_PAGE_DESCRIPTION,
    canonicalUrl: DIRECTORY_HREF,
  });

// 検索結果は同じヘルプトップの中の表示のため、正規のURLは検索語を含まないヘルプトップにする
export const buildHelpTopHead = () =>
  buildSitePageHead({ title: HELP_TOP_TITLE, canonicalUrl: HELP_TOP_HREF });

// 本人だけが読むページのため、検索の索引の対象外にする
export const buildInquiryChatHead = () =>
  buildSitePageHead({ title: INQUIRY_CHAT_PAGE_TITLE, noIndex: true });

// 本人だけが開く購入ごとのページのため、検索の索引の対象外にする
export const buildCheckoutHead = () =>
  buildSitePageHead({ title: CHECKOUT_PAGE_TITLE, noIndex: true });

// 決済セッションのIDを含むURLで本人だけが開くページのため、検索の索引の対象外にする
export const buildCheckoutReturnHead = () =>
  buildSitePageHead({ title: CHECKOUT_RETURN_PAGE_TITLE, noIndex: true });

// 配色の初回描画前のスクリプトはAppDocumentが置くため、ここには置かない
export const buildRootHead = ({
  stylesheetHref,
  webAnalyticsToken,
}: RootHeadInput) => {
  const analytics = webAnalyticsHeadScript(webAnalyticsToken);
  const scripts: WebAnalyticsHeadScript[] =
    analytics === undefined ? [] : [analytics];
  return {
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ...buildSitePageHead({ title: '' }).meta,
    ],
    links: [{ rel: 'stylesheet', href: stylesheetHref }],
    scripts,
  };
};

// 誰でも見られる公開のページのため、現在のハンドルの表記のパスを正規のURLにして、表記の違うURLを同じページとして索引へ載せる。取得前や失敗ではタイトルを決められないため、サイト名だけにして正規のURLも付けない
export const buildPublicProfileHead = (
  loaderData: PublicProfileLoaderData | undefined,
) =>
  loaderData === undefined
    ? buildSitePageHead({ title: '' })
    : buildSitePageHead({
        title: `${loaderData.nickname}(@${loaderData.handle})`,
        canonicalUrl: profileHref(loaderData.handle),
      });

// 現在のハンドルの表記のパスを正規のURLにして、表記の違うURLや旧ハンドルのURLを同じページとして索引へ載せる。未掲載のプロダクトは投稿者本人にだけ表示しているため索引の対象外にする。取得前や失敗ではタイトルを決められないため、サイト名だけにして正規のURLも付けない
export const buildProductPageHead = (
  loaderData: ProductPageLoaderData | undefined,
) =>
  loaderData === undefined
    ? buildSitePageHead({ title: '' })
    : buildSitePageHead({
        title: loaderData.name,
        description: loaderData.tagline,
        canonicalUrl: productDetailHref(loaderData.handle),
        ...(loaderData.listed ? {} : { noIndex: true }),
      });
