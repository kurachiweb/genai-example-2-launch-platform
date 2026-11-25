import { queryOptions } from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { graphqlMutationOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientMyWeekEntryDocument,
  ClientProductTrophiesDocument,
  ClientStartWeekTournamentCheckoutDocument,
  ClientWeekBracketDocument,
  ClientWeekTournamentBoardDocument,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

const GUEST_SCOPE = 'guest';

const viewerScopeOf = (viewer: ClientViewer | null): string =>
  viewer === null ? GUEST_SCOPE : viewer.id;

// 閲覧者のUpvote済みの側・自分のプロダクト・Upvoteできない理由を含むため、同じタブでログイン・ログアウトした後に前の閲覧者の値を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const weekTournamentBoardQueryOptions = (
  viewer: ClientViewer | null,
  date: string,
) => {
  const variables = { date };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientWeekTournamentBoardDocument, variables),
      viewerScopeOf(viewer),
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientWeekTournamentBoardDocument, variables, {
          signal,
        }),
      ),
  });
};

// 非公開のプロダクトは投稿者本人にだけ見えるため、共通の取得の補助のキーの後に閲覧者のIDを加える
export const weekBracketQueryOptions = (
  viewer: ClientViewer | null,
  week: string,
) => {
  const variables = { week };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientWeekBracketDocument, variables),
      viewerScopeOf(viewer),
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientWeekBracketDocument, variables, { signal }),
      ),
  });
};

// 参加費の導線は投稿者本人の枠のため、同じタブで別の利用者がログインした後に前の取得結果を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const myWeekEntryQueryOptions = (
  viewer: ClientViewer,
  productHandle: string,
) => {
  const variables = { productHandle };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientMyWeekEntryDocument, variables),
      viewer.id,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientMyWeekEntryDocument, variables, { signal }),
      ),
  });
};

// 非公開のプロダクトは投稿者本人にだけ見えるため、共通の取得の補助のキーの後に閲覧者のIDを加える
export const productTrophiesQueryOptions = (
  viewer: ClientViewer | null,
  productHandle: string,
) => {
  const variables = { productHandle };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientProductTrophiesDocument, variables),
      viewerScopeOf(viewer),
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientProductTrophiesDocument, variables, {
          signal,
        }),
      ),
  });
};

export const startWeekTournamentCheckoutMutationOptions = () =>
  graphqlMutationOptions(ClientStartWeekTournamentCheckoutDocument);
