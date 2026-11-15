import { createFileRoute } from '@tanstack/react-router';

import { normalizeDirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { DirectoryPage } from '../../components/directory/directory-page.tsx';
import { useAppliedDirectoryQuery } from '../../components/directory/use-applied-directory-query.ts';
import {
  DIRECTORY_ITEM_METRICS,
  DIRECTORY_LIST_INSERTS,
  DIRECTORY_PAGE_SECTIONS,
} from '../../composition/directory-sections.ts';
import { loadDirectory } from '../../graphql/directory.ts';
import { buildDirectoryHead } from '../../head/page-heads.ts';

// 不正なクエリは検証で既定の値へ戻り、ルーターがURLを正規化した条件へ置き換える(サーバーでの描画では転送する)
export const Route = createFileRoute('/p/')({
  validateSearch: normalizeDirectoryQuery,
  loaderDeps: ({ search }) => search,
  loader: loadDirectory,
  head: buildDirectoryHead,
  component: DirectoryRoute,
});

function DirectoryRoute() {
  const query = Route.useSearch();
  const { viewer } = Route.useRouteContext();
  useAppliedDirectoryQuery(query, viewer);
  return (
    <DirectoryPage
      query={query}
      viewer={viewer}
      sections={DIRECTORY_PAGE_SECTIONS}
      inserts={DIRECTORY_LIST_INSERTS}
      metrics={DIRECTORY_ITEM_METRICS}
    />
  );
}
