import { queryOptions } from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { graphqlMutationOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientMyYearEntryDocument,
  ClientStartYearTournamentCheckoutDocument,
  ClientYearBracketDocument,
  ClientYearTournamentBoardDocument,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

const GUEST_SCOPE = 'guest';

const viewerScopeOf = (viewer: ClientViewer | null): string =>
  viewer === null ? GUEST_SCOPE : viewer.id;

// 閲覧者のUpvote済みの側・自分のプロダクト・Upvoteできない理由を含むため、同じタブでログイン・ログアウトした後に前の閲覧者の値を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const yearTournamentBoardQueryOptions = (
  viewer: ClientViewer | null,
  date: string,
) => {
  const variables = { date };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientYearTournamentBoardDocument, variables),
      viewerScopeOf(viewer),
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientYearTournamentBoardDocument, variables, {
          signal,
        }),
      ),
  });
};

// 非公開のプロダクトは投稿者本人にだけ見えるため、共通の取得の補助のキーの後に閲覧者のIDを加える
export const yearBracketQueryOptions = (
  viewer: ClientViewer | null,
  year: string,
) => {
  const variables = { year };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientYearBracketDocument, variables),
      viewerScopeOf(viewer),
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientYearBracketDocument, variables, { signal }),
      ),
  });
};

// 参加費の導線は投稿者本人の枠のため、同じタブで別の利用者がログインした後に前の取得結果を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const myYearEntryQueryOptions = (
  viewer: ClientViewer,
  productHandle: string,
) => {
  const variables = { productHandle };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientMyYearEntryDocument, variables),
      viewer.id,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientMyYearEntryDocument, variables, { signal }),
      ),
  });
};

export const startYearTournamentCheckoutMutationOptions = () =>
  graphqlMutationOptions(ClientStartYearTournamentCheckoutDocument);
