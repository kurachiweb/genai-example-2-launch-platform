import type { AdminSponsorshipsReader } from '../../../../application/sponsorship/admin-sponsorships-reader.ts';
import type { SponsorshipTermination } from '../../../../application/sponsorship/sponsorship-termination.ts';
import { SPONSORSHIP_TYPES } from '../../../../application/sponsorship/sponsorship-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  ADMIN_SPONSORSHIPS_ARGS,
  SPONSORSHIP_TERMINATION_PREVIEW_ARGS,
  TERMINATE_SPONSORSHIP_ARGS,
} from './inputs.ts';
import { adminOnly, clockOf, roleRequirementOf } from './resolver-support.ts';
import {
  toAdminSponsorship,
  toTerminationPreview,
  toTerminationResult,
} from './sponsorship-views.ts';

const adminReaderOf = (context: GraphQLContext): AdminSponsorshipsReader =>
  context.resolve<AdminSponsorshipsReader>(
    SPONSORSHIP_TYPES.AdminSponsorshipsReader,
  );

const terminationOf = (context: GraphQLContext): SponsorshipTermination =>
  context.resolve<SponsorshipTermination>(
    SPONSORSHIP_TYPES.SponsorshipTermination,
  );

// 必要なロールは、一覧は閲覧のみ以上、強制終了の照会と確定はモデレーター以上としてユースケースが宣言する
export const adminResolvers = {
  Query: {
    adminSponsorships: adminOnly(
      withValidatedArgs(
        ADMIN_SPONSORSHIPS_ARGS,
        async (_parent: unknown, { filter, first, after }, context) => {
          const page = await adminReaderOf(context).list({
            requireRole: roleRequirementOf(context),
            filter,
            first,
            ...(after !== undefined && { after }),
            now: clockOf(context).now(),
          });
          return {
            nodes: page.views.map(toAdminSponsorship),
            pageInfo: {
              hasNextPage: page.hasNextPage,
              endCursor: page.endCursor,
            },
          };
        },
      ),
    ),
    sponsorshipTerminationPreview: adminOnly(
      withValidatedArgs(
        SPONSORSHIP_TERMINATION_PREVIEW_ARGS,
        async (_parent: unknown, { id }, context) =>
          toTerminationPreview(
            await terminationOf(context).preview({
              sponsorshipId: id,
              now: clockOf(context).now(),
              requireRole: roleRequirementOf(context),
            }),
          ),
      ),
    ),
  },
  Mutation: {
    terminateSponsorship: adminOnly(
      withValidatedArgs(
        TERMINATE_SPONSORSHIP_ARGS,
        async (_parent: unknown, { id, reason }, context) =>
          toTerminationResult(
            await terminationOf(context).terminate({
              sponsorshipId: id,
              reason,
              now: clockOf(context).now(),
              requireRole: roleRequirementOf(context),
            }),
          ),
      ),
    ),
  },
} satisfies Resolvers;
