import { z } from '../../../lib/utilities/validation/zod.ts';
import type {
  AdminSponsorshipFilter,
  AdminSponsorshipStatusFilter,
  AdminSponsorshipsQueryVariables,
  SponsorshipTier,
} from '../../graphql/generated/graphql.ts';

// 絞り込みの条件(掲載状況とティアはAPIの列挙の値)と、ページの位置のカーソル
export interface AdminSponsorshipSearch {
  readonly status?: AdminSponsorshipStatusFilter | undefined;
  readonly tier?: SponsorshipTier | undefined;
  readonly after?: string | undefined;
}

export const ADMIN_SPONSORSHIP_STATUS_FILTERS = [
  'PENDING_PAYMENT',
  'SCHEDULED',
  'ACTIVE',
  'ENDED',
  'TERMINATED',
] as const satisfies readonly AdminSponsorshipStatusFilter[];

export const ADMIN_SPONSORSHIP_TIERS = [
  'LEGEND',
  'GOLD',
  'SILVER',
] as const satisfies readonly SponsorshipTier[];

export const ADMIN_SPONSORSHIPS_PAGE_SIZE = 50;

const CURSOR_MAX = 256;

const SEARCH_KEYS = [
  'status',
  'tier',
  'after',
] as const satisfies readonly (keyof AdminSponsorshipSearch)[];

const FILTER_KEYS = SEARCH_KEYS.filter((key) => key !== 'after');

// 共有されたURLや手で書き換えたURLの不正な値は、APIの拒否でページを失敗させず、その条件を未指定として扱う
const SEARCH_SCHEMA = z.object({
  status: z.enum(ADMIN_SPONSORSHIP_STATUS_FILTERS).optional().catch(undefined),
  tier: z.enum(ADMIN_SPONSORSHIP_TIERS).optional().catch(undefined),
  after: z.string().min(1).max(CURSOR_MAX).optional().catch(undefined),
});

// 値の無い項目を持たない検索パラメータにし、URLに空の項目を残さない
const definedEntriesOf = (
  source: AdminSponsorshipSearch,
  keys: readonly (keyof AdminSponsorshipSearch)[],
): AdminSponsorshipSearch =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = source[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );

// ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に全ての項目を返す
export const toAdminSponsorshipSearch = (
  search: Record<string, unknown>,
): AdminSponsorshipSearch => {
  const { status, tier, after } = SEARCH_SCHEMA.parse(search);
  return { status, tier, after };
};

export function adminSponsorshipVariablesOf({
  status,
  tier,
  after,
}: AdminSponsorshipSearch): AdminSponsorshipsQueryVariables {
  const filter: AdminSponsorshipFilter = {
    ...(status !== undefined && { status }),
    ...(tier !== undefined && { tier }),
  };
  return {
    filter,
    first: ADMIN_SPONSORSHIPS_PAGE_SIZE,
    ...(after !== undefined && { after }),
  };
}

// ページの位置を除いた条件を、項目の順に依らない1つの値にする
export const adminSponsorshipFilterScopeOf = (
  search: AdminSponsorshipSearch,
): string => JSON.stringify(FILTER_KEYS.map((key) => search[key] ?? null));

// 条件を保ったまま、ページの位置だけを替える。undefinedは1ページ目
export const adminSponsorshipSearchAt = (
  search: AdminSponsorshipSearch,
  after: string | undefined,
): AdminSponsorshipSearch => ({
  ...definedEntriesOf(search, FILTER_KEYS),
  ...(after !== undefined && { after }),
});
