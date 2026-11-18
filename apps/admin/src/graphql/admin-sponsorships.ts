import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  AdminSponsorshipsDocument,
  type AdminSponsorshipsQuery,
  type AdminSponsorshipsQueryVariables,
  AdminSponsorshipTerminationPreviewDocument,
  type AdminSponsorshipTerminationPreviewQuery,
  type AdminTerminateSponsorshipMutation,
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
