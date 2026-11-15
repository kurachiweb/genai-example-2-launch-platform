import type { ClientProductLiveMatchQuery } from '../../graphql/generated/graphql.ts';
import { matchOf } from '../match/match-fixtures.ts';

export type ProductLiveMatchView = NonNullable<
  ClientProductLiveMatchQuery['productLiveMatch']
>;

export type LiveMatchView = NonNullable<ProductLiveMatchView['match']>;

// 業務日付2026-11-10の23:40(日本時間)
export const LIVE_MATCH_ENDS_AT = '2026-11-10T14:40:00.000Z';

// 業務日付2026-11-10の12:00(日本時間)
export const LIVE_MATCH_SERVER_TIME = '2026-11-10T03:00:00.000Z';

export const liveMatchOf = (
  overrides: Partial<LiveMatchView> = {},
): LiveMatchView => ({
  ...matchOf(),
  endsAt: LIVE_MATCH_ENDS_AT,
  ...overrides,
});

export const productLiveMatchOf = (
  overrides: Partial<ProductLiveMatchView> = {},
): ProductLiveMatchView => ({
  serverTime: LIVE_MATCH_SERVER_TIME,
  awaitingChange: false,
  match: liveMatchOf(),
  ...overrides,
});
