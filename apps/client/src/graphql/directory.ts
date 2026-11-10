import { queryOptions } from '@tanstack/react-query';

import type { DirectoryQuery } from '../../common-lib/directory/directory-query-rules.ts';
import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientDirectoryCategoriesDocument,
  ClientDirectoryDocument,
  type DirectoryInput,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

const GUEST_SCOPE = 'guest';

// 同じ条件が既定の項目の有無で別のキーにならないよう、指定された項目だけを入力にする
export const directoryInputOf = ({
  q,
  category,
  from,
  to,
  sort,
  page,
}: DirectoryQuery): DirectoryInput => ({
  ...(q === undefined ? {} : { q }),
  ...(category === undefined ? {} : { category }),
  ...(from === undefined ? {} : { from }),
  ...(to === undefined ? {} : { to }),
  ...(sort === undefined ? {} : { sort }),
  ...(page === undefined ? {} : { page: String(page) }),
});

// 項目の「あなたのプロダクト」は閲覧者で変わるため、同じタブでログイン・ログアウトした後に前の閲覧者の値を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const directoryQueryOptions = (
  query: DirectoryQuery,
  viewer: ClientViewer | null,
) => {
  const variables = { input: directoryInputOf(query) };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientDirectoryDocument, variables),
      viewer === null ? GUEST_SCOPE : viewer.id,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientDirectoryDocument, variables, { signal }),
      ),
  });
};

export const directoryCategoriesQueryOptions = () =>
  graphqlQueryOptions(ClientDirectoryCategoriesDocument, {});
