import { useSuspenseQuery } from '@tanstack/react-query';

import { graphqlQueryOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  ClientSponsoredPlacementsDocument,
  type ClientSponsoredPlacementsQuery,
} from '../../graphql/generated/graphql.ts';

const SPONSORED_PLACEMENTS_STALE_TIME_MS = 60_000;

// 広告の並びは照会のたびに無作為に変わるため、1回のページの表示の全ての区画が同じキーの1回の取得を読み、一覧への差し込みと余りを同じ順にする
export const sponsoredPlacementsQueryOptions = () => ({
  ...graphqlQueryOptions(ClientSponsoredPlacementsDocument, {}),
  staleTime: SPONSORED_PLACEMENTS_STALE_TIME_MS,
});

export function useSponsoredPlacements(): ClientSponsoredPlacementsQuery['sponsoredPlacements'] {
  return useSuspenseQuery(sponsoredPlacementsQueryOptions()).data
    .sponsoredPlacements;
}
