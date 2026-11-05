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
import { SITE_NAME } from '../components/layout/site-links.ts';
import type {
  LegalDocumentLoaderData,
  LegalVersionLoaderData,
} from '../graphql/legal-documents.ts';

export interface RootHeadInput {
  readonly stylesheetHref: string;
  readonly webAnalyticsToken: string | undefined;
}

export interface SitePageHeadInput {
  readonly title: string;
  readonly canonicalUrl?: string;
  readonly noIndex?: boolean;
}

// TanStack Routerのheadは書き換え可能な配列を求めるため、凍結された配列を広げて新しい配列で返す
export const buildSitePageHead = ({
  title,
  canonicalUrl,
  noIndex,
}: SitePageHeadInput) => {
  const head = buildPageHead({
    title,
    siteName: SITE_NAME,
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
