import type { SponsorshipStatus as SponsorshipStatusValue } from '../../common-lib/sponsorship/sponsorship-status.ts';
import type { SponsorshipTier as SponsorshipTierValue } from '../../common-lib/sponsorship/sponsorship-tiers.ts';
import type { RouterContext } from '../../lib/start/router-context.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  type AdminSponsorshipSearch,
  adminSponsorshipVariablesOf,
} from '../components/sponsorship/admin-sponsorship-search.ts';
import {
  AdminSponsorshipsDocument,
  type AdminSponsorshipsQuery,
  type AdminSponsorshipsQueryVariables,
  AdminSponsorshipTerminationPreviewDocument,
  type AdminSponsorshipTerminationPreviewQuery,
  type AdminTerminateSponsorshipMutation,
  type SponsorshipStatus,
  type SponsorshipTier,
} from './generated/graphql.ts';

export type AdminSponsorshipPage = AdminSponsorshipsQuery['adminSponsorships'];

export type AdminSponsorshipRow = AdminSponsorshipPage['nodes'][number];

export type AdminSponsorshipTerminationPreview =
  AdminSponsorshipTerminationPreviewQuery['sponsorshipTerminationPreview'];

export type AdminSponsorshipTerminationResult =
  AdminTerminateSponsorshipMutation['terminateSponsorship'];

export const adminSponsorshipsQueryOptions = (
  variables: AdminSponsorshipsQueryVariables,
) => graphqlQueryOptions(AdminSponsorshipsDocument, variables);

export const adminSponsorshipTerminationPreviewQueryOptions = (id: string) =>
  graphqlQueryOptions(AdminSponsorshipTerminationPreviewDocument, { id });

export const toAdminSponsorshipPage = ({
  adminSponsorships,
}: AdminSponsorshipsQuery): AdminSponsorshipPage => adminSponsorships;

const STATUS_OF: Readonly<Record<SponsorshipStatus, SponsorshipStatusValue>> =
  Object.freeze({
    PENDING_PAYMENT: 'pending_payment',
    SCHEDULED: 'scheduled',
    ACTIVE: 'active',
    PAUSED: 'paused',
    ENDED: 'ended',
    TERMINATED: 'terminated',
  });

const TIER_OF: Readonly<Record<SponsorshipTier, SponsorshipTierValue>> =
  Object.freeze({ LEGEND: 'legend', GOLD: 'gold', SILVER: 'silver' });

// GraphQLの列挙は大文字のため、表示名を引く共用部品の値へ写す
export const toSponsorshipStatus = (
  status: SponsorshipStatus,
): SponsorshipStatusValue => STATUS_OF[status];

export const toSponsorshipTier = (
  tier: SponsorshipTier,
): SponsorshipTierValue => TIER_OF[tier];

// 一覧の取得の失敗は一覧の中で再試行できるよう、例外にせずキャッシュに残す
export async function loadAdminSponsorshipsPage({
  context,
  deps,
}: {
  readonly context: Pick<RouterContext, 'queryClient'>;
  readonly deps: AdminSponsorshipSearch;
}): Promise<void> {
  await context.queryClient
    .query(adminSponsorshipsQueryOptions(adminSponsorshipVariablesOf(deps)))
    .catch(() => undefined);
}
