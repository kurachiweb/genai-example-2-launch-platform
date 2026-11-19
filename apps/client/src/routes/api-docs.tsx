import { createFileRoute } from '@tanstack/react-router';

import { API_DOCS_PAGE_TITLE } from '../components/public-api/api-docs-messages.ts';
import { ApiDocsPage } from '../components/public-api/api-docs-page.tsx';
import { API_DOCS_HREF } from '../components/public-api/api-key-list-messages.ts';
import { buildSitePageHead } from '../head/page-heads.ts';

// 仕様書はブラウザで公開APIから取得するため、ページのloaderを持たない
export const Route = createFileRoute('/api-docs')({
  head: () =>
    buildSitePageHead({
      title: API_DOCS_PAGE_TITLE,
      canonicalUrl: API_DOCS_HREF,
    }),
  component: ApiDocsPage,
});
