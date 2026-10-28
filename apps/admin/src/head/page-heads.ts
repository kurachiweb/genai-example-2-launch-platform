import { buildPageHead } from '../../lib/start/page-head.ts';
import { ADMIN_SITE_NAME } from '../components/layout/admin-site.ts';

export interface RootHeadInput {
  readonly stylesheetHref: string;
}

export interface AdminPageHeadInput {
  readonly title: string;
  readonly noIndex?: boolean;
}

// TanStack Routerのheadは書き換え可能な配列を求めるため、凍結された配列を広げて新しい配列で返す
export const buildAdminPageHead = ({ title, noIndex }: AdminPageHeadInput) => {
  const head = buildPageHead({
    title,
    siteName: ADMIN_SITE_NAME,
    ...(noIndex === undefined ? {} : { noIndex }),
  });
  return { meta: [...head.meta], links: [...head.links] };
};

// 配色の初回描画前のスクリプトはAppDocumentが置き、管理者側はアクセス解析を組み込まないため、headにスクリプトを置かない
export const buildRootHead = ({ stylesheetHref }: RootHeadInput) => ({
  meta: [
    { charSet: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ...buildAdminPageHead({ title: '' }).meta,
  ],
  links: [{ rel: 'stylesheet', href: stylesheetHref }],
});
