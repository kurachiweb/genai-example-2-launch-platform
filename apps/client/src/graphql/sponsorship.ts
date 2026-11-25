import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
} from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { graphqlMutationOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import type { BusinessDateString } from '../../common-lib/sponsorship/sponsorship-period.ts';
import type { SponsorshipStatus } from '../../common-lib/sponsorship/sponsorship-status.ts';
import type { SponsorshipTier } from '../../common-lib/sponsorship/sponsorship-tiers.ts';
import {
  ClientActiveSponsorshipCountDocument,
  ClientApplySponsorshipDocument,
  ClientMySponsorshipsDocument,
  type ClientMySponsorshipsQuery,
  type ClientMySponsorshipsQueryVariables,
  ClientResumeSponsorshipCheckoutDocument,
  ClientSponsorshipOfferDocument,
  ClientSponsorshipPeriodWindowDocument,
  type ClientSponsorshipPeriodWindowQueryVariables,
  type SponsorshipStatus as GraphQLSponsorshipStatus,
  type SponsorshipTier as GraphQLSponsorshipTier,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

export const MY_SPONSORSHIPS_PAGE_SIZE = 20;

export type MySponsorshipsData = InfiniteData<
  ClientMySponsorshipsQuery,
  string | null
>;

export interface SponsorshipPeriodWindowInput {
  readonly productId: string;
  readonly tier: SponsorshipTier;
  // 開始日を選ぶまではnull
  readonly startsOn: BusinessDateString | null;
}

const GUEST_SCOPE = 'guest';

const TIER_OF: Readonly<Record<GraphQLSponsorshipTier, SponsorshipTier>> =
  Object.freeze({ LEGEND: 'legend', GOLD: 'gold', SILVER: 'silver' });

const GRAPHQL_TIER_OF: Readonly<
  Record<SponsorshipTier, GraphQLSponsorshipTier>
> = Object.freeze({ legend: 'LEGEND', gold: 'GOLD', silver: 'SILVER' });

const STATUS_OF: Readonly<Record<GraphQLSponsorshipStatus, SponsorshipStatus>> =
  Object.freeze({
    PENDING_PAYMENT: 'pending_payment',
    SCHEDULED: 'scheduled',
    ACTIVE: 'active',
    PAUSED: 'paused',
    ENDED: 'ended',
    TERMINATED: 'terminated',
  });

// GraphQLの列挙は大文字のため、表示名を引く共用部品の値と相互に写す
export const toSponsorshipTier = (
  tier: GraphQLSponsorshipTier,
): SponsorshipTier => TIER_OF[tier];

export const toGraphQLSponsorshipTier = (
  tier: SponsorshipTier,
): GraphQLSponsorshipTier => GRAPHQL_TIER_OF[tier];

export const toSponsorshipStatus = (
  status: GraphQLSponsorshipStatus,
): SponsorshipStatus => STATUS_OF[status];

// 価格は閲覧者によらないが申込の対象のプロダクトは閲覧者のものであるため、同じタブでログイン・ログアウトした後に前の閲覧者の一覧を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const sponsorshipOfferQueryOptions = (viewer: ClientViewer | null) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientSponsorshipOfferDocument, {}),
      viewer === null ? GUEST_SCOPE : viewer.id,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientSponsorshipOfferDocument, {}, { signal }),
      ),
  });

// 選べる範囲は本人のプロダクトに対して返るため、共通の取得の補助のキーの後に閲覧者のIDを加える
export const sponsorshipPeriodWindowQueryOptions = (
  viewer: ClientViewer,
  { productId, tier, startsOn }: SponsorshipPeriodWindowInput,
) => {
  const base = { productId, tier: toGraphQLSponsorshipTier(tier) };
  const variables: ClientSponsorshipPeriodWindowQueryVariables =
    startsOn === null ? base : { ...base, startsOn };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientSponsorshipPeriodWindowDocument, variables),
      viewer.id,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientSponsorshipPeriodWindowDocument, variables, {
          signal,
        }),
      ),
  });
};

// 0:00の境界と、申込の重なりの拒否で選べる範囲が変わるため、表示中の範囲を取り直し、表示していない範囲は次に表示した時に取り直す
export async function invalidateSponsorshipPeriodWindowQueries(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: [documentIdOf(ClientSponsorshipPeriodWindowDocument)],
  });
}

const FIRST_PAGE_VARIABLES: ClientMySponsorshipsQueryVariables = Object.freeze({
  first: MY_SPONSORSHIPS_PAGE_SIZE,
});

// 自分の広告一覧はセッションの利用者のものであるため、共通の取得の補助のキーの後に閲覧者のIDを加える。続きのページは最後の申込のカーソルから読む
export const mySponsorshipsQueryOptions = (viewerId: string) =>
  infiniteQueryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientMySponsorshipsDocument, FIRST_PAGE_VARIABLES),
      viewerId,
    ],
    queryFn: async ({ pageParam, signal }) =>
      requireData(
        await executeGraphQL(
          ClientMySponsorshipsDocument,
          pageParam === null
            ? FIRST_PAGE_VARIABLES
            : { ...FIRST_PAGE_VARIABLES, after: pageParam },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: ({
      mySponsorships: { pageInfo },
    }: ClientMySponsorshipsQuery): string | undefined =>
      pageInfo.hasNextPage && pageInfo.endCursor !== null
        ? pageInfo.endCursor
        : undefined,
  });

// 取得の失敗は設定のナビゲーションを残したまま一覧の中で再試行できるよう、例外にせずキャッシュに残す。続きのページはここで読み足さず、画面の「さらに表示」で読む
export async function loadMySponsorships({
  context,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer;
  };
}): Promise<void> {
  await context.queryClient
    .infiniteQuery(mySponsorshipsQueryOptions(context.viewer.id))
    .catch(() => undefined);
}

// 本人のプロダクトでなければ0が返るため、同じタブで別の利用者がログインした後に前の件数を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const activeSponsorshipCountQueryOptions = (
  viewer: ClientViewer,
  productHandle: string,
) => {
  const variables = { productHandle };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientActiveSponsorshipCountDocument, variables),
      viewer.id,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientActiveSponsorshipCountDocument, variables, {
          signal,
        }),
      ),
  });
};

export const applySponsorshipMutationOptions = () =>
  graphqlMutationOptions(ClientApplySponsorshipDocument);

export const resumeSponsorshipCheckoutMutationOptions = () =>
  graphqlMutationOptions(ClientResumeSponsorshipCheckoutDocument);
