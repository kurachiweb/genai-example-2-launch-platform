import { SPONSORSHIP_PLATFORM_TYPES } from '../../../../../lib/core/sponsorship/identifiers.ts';
import type { PlacementReader } from '../../../../../lib/core/sponsorship/ports.ts';
import { toBusinessDateTime } from '../../../../../lib/core/time/business-time.ts';
import type { MySponsorshipsReader } from '../../../../application/sponsorship/my-sponsorships-reader.ts';
import type { SponsorshipApplication } from '../../../../application/sponsorship/sponsorship-application.ts';
import type { SponsorshipOfferReader } from '../../../../application/sponsorship/sponsorship-offer-reader.ts';
import { SPONSORSHIP_TYPES } from '../../../../application/sponsorship/sponsorship-types.ts';
import { withInputPath } from '../../field-paths.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  APPLY_SPONSORSHIP_ARGS,
  MY_SPONSORSHIPS_ARGS,
  RESUME_SPONSORSHIP_CHECKOUT_ARGS,
  SPONSORSHIP_PERIOD_WINDOW_ARGS,
} from './inputs.ts';
import {
  accountGuardOf,
  clientOnly,
  clockOf,
  SPONSORSHIP_APPLY_BOT_ACTION,
} from './resolver-support.ts';
import {
  TIER_VALUES,
  toDateWindow,
  toMySponsorship,
  toSponsorableProduct,
  toSponsoredAd,
} from './sponsorship-views.ts';

const offerReaderOf = (context: GraphQLContext): SponsorshipOfferReader =>
  context.resolve<SponsorshipOfferReader>(
    SPONSORSHIP_TYPES.SponsorshipOfferReader,
  );

const myReaderOf = (context: GraphQLContext): MySponsorshipsReader =>
  context.resolve<MySponsorshipsReader>(SPONSORSHIP_TYPES.MySponsorshipsReader);

const applicationOf = (context: GraphQLContext): SponsorshipApplication =>
  context.resolve<SponsorshipApplication>(
    SPONSORSHIP_TYPES.SponsorshipApplication,
  );

const placementReaderOf = (context: GraphQLContext): PlacementReader =>
  context.resolve<PlacementReader>(SPONSORSHIP_PLATFORM_TYPES.PlacementReader);

// bot判定のトークンは1回しか検証できないため、ユースケースがログインと利用者の状態を確かめた後に呼ぶ
const humanCheckOf = (context: GraphQLContext) => () =>
  context.assertHuman(SPONSORSHIP_APPLY_BOT_ACTION);

export const clientResolvers = {
  Query: {
    sponsorshipOffer: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const viewer = await accountGuardOf(context).currentUser(
          context.session,
        );
        const offer = await offerReaderOf(context).read({
          viewer,
          now: clockOf(context).now(),
        });
        return {
          tiers: offer.tiers.map(({ tier, unitPrice }) => ({
            tier: TIER_VALUES[tier],
            unitPrice,
          })),
          eligibleProducts:
            offer.eligibleProducts?.map(toSponsorableProduct) ?? null,
        };
      },
    ),
    sponsorshipPeriodWindow: clientOnly(
      withValidatedArgs(
        SPONSORSHIP_PERIOD_WINDOW_ARGS,
        async (_parent: unknown, { productId, tier, startsOn }, context) => {
          const window = await offerReaderOf(context).readPeriodWindow({
            session: context.session,
            productId,
            tier,
            startsOn,
            now: clockOf(context).now(),
          });
          return {
            businessToday: window.businessToday,
            nextDayStartsAt: window.nextDayStartsAt,
            start: toDateWindow(window.start),
            end: window.end === null ? null : toDateWindow(window.end),
          };
        },
      ),
    ),
    sponsoredPlacements: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const placements = await placementReaderOf(context).read(
          clockOf(context).now(),
        );
        return {
          legend: placements.legend.map(toSponsoredAd),
          gold: placements.gold.map(toSponsoredAd),
          silver: placements.silver.map(toSponsoredAd),
        };
      },
    ),
    mySponsorships: clientOnly(
      withValidatedArgs(
        MY_SPONSORSHIPS_ARGS,
        async (_parent: unknown, { first, after }, context) => {
          const now = clockOf(context).now();
          const page = await myReaderOf(context).list({
            session: context.session,
            first,
            ...(after !== undefined && { after }),
            now,
          });
          const today = toBusinessDateTime(now).date;
          return {
            nodes: page.views.map((view) => toMySponsorship(view, today)),
            pageInfo: {
              hasNextPage: page.hasNextPage,
              endCursor: page.endCursor,
            },
            nextDayStartsAt: page.nextDayStartsAt,
          };
        },
      ),
    ),
    activeSponsorshipCount: clientOnly(
      async (
        _parent: unknown,
        { productHandle }: { productHandle: string },
        context: GraphQLContext,
      ) =>
        myReaderOf(context).countActiveForProduct({
          session: context.session,
          productHandle,
          now: clockOf(context).now(),
        }),
    ),
  },
  Mutation: {
    applySponsorship: clientOnly(
      withValidatedArgs(
        APPLY_SPONSORSHIP_ARGS,
        async (_parent: unknown, { input }, context) =>
          withInputPath('input', () =>
            applicationOf(context).apply({
              session: context.session,
              fields: input,
              humanCheck: humanCheckOf(context),
              now: clockOf(context).now(),
            }),
          ),
      ),
    ),
    resumeSponsorshipCheckout: clientOnly(
      withValidatedArgs(
        RESUME_SPONSORSHIP_CHECKOUT_ARGS,
        async (_parent: unknown, { id }, context) =>
          applicationOf(context).resume({
            session: context.session,
            sponsorshipId: id,
            humanCheck: humanCheckOf(context),
            now: clockOf(context).now(),
          }),
      ),
    ),
  },
} satisfies Resolvers;
