import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import type {
  ClientSponsoredPlacementsQuery,
  SponsoredAdFieldsFragment,
  SponsorshipTier,
} from '../../graphql/generated/graphql.ts';

export type SponsoredPlacementsView =
  ClientSponsoredPlacementsQuery['sponsoredPlacements'];

const TIER_NAMES: Readonly<Record<SponsorshipTier, string>> = Object.freeze({
  LEGEND: 'Legend',
  GOLD: 'Gold',
  SILVER: 'Silver',
});

// n番目の広告。名称は「<ティア> Ad <n>」で、ロゴを持たず頭文字の代わりの表示を描く
export const sponsoredAdOf = (
  tier: SponsorshipTier,
  n: number,
  overrides: Partial<SponsoredAdFieldsFragment> = {},
): SponsoredAdFieldsFragment => ({
  id: `01J${tier}${String(n).padStart(4, '0')}`.padEnd(26, '0'),
  tier,
  productName: `${TIER_NAMES[tier]} Ad ${String(n)}`,
  tagline: `${TIER_NAMES[tier]}の広告のタグライン${String(n)}`,
  websiteUrl: `https://ad-${String(n)}.example/`,
  logo: null,
  ...overrides,
});

export const sponsoredAdsOf = (
  tier: SponsorshipTier,
  count: number,
): readonly SponsoredAdFieldsFragment[] =>
  Array.from({ length: count }, (_, index) => sponsoredAdOf(tier, index + 1));

export const placementsOf = ({
  legend = 0,
  gold = 0,
  silver = 0,
}: {
  readonly legend?: number;
  readonly gold?: number;
  readonly silver?: number;
}): ClientSponsoredPlacementsQuery => ({
  sponsoredPlacements: {
    legend: [...sponsoredAdsOf('LEGEND', legend)],
    gold: [...sponsoredAdsOf('GOLD', gold)],
    silver: [...sponsoredAdsOf('SILVER', silver)],
  },
});

export const PLACEMENTS_LOAD_FAILURE = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

// 一覧の項目ごとの広告の名称。カードは名称を最初の段落に描く
export const adNamesIn = (
  items: readonly Element[],
): readonly (string | null | undefined)[] =>
  items.map((item) => item.querySelector('p')?.textContent);

export const adNamesOf = (
  tier: SponsorshipTier,
  count: number,
): readonly string[] => sponsoredAdsOf(tier, count).map((ad) => ad.productName);
