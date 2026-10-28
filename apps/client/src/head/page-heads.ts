import {
  type WebAnalyticsHeadScript,
  webAnalyticsHeadScript,
} from '../../lib/start/observability/web-analytics.ts';
import { buildPageHead } from '../../lib/start/page-head.ts';
import { SITE_NAME } from '../components/layout/site-links.ts';

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
