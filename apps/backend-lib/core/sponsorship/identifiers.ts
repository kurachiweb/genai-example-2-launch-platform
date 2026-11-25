const SponsorshipStore: unique symbol = Symbol.for(
  'sponsorship.SponsorshipStore',
);
const EligibleProductReader: unique symbol = Symbol.for(
  'sponsorship.EligibleProductReader',
);
const PlacementReader: unique symbol = Symbol.for(
  'sponsorship.PlacementReader',
);
const SponsorshipOfferPolicy: unique symbol = Symbol.for(
  'sponsorship.SponsorshipOfferPolicy',
);
const SponsorshipFulfillment: unique symbol = Symbol.for(
  'sponsorship.SponsorshipFulfillment',
);
const NoticeScheduler: unique symbol = Symbol.for(
  'sponsorship.NoticeScheduler',
);
const NoticeRequester: unique symbol = Symbol.for(
  'sponsorship.NoticeRequester',
);
const DisplayStopStore: unique symbol = Symbol.for(
  'sponsorship.DisplayStopStore',
);
// 契約はworkers/sponsorshipにあり、infrastructure層と共有の部品だけが受け取る
const DisplayStopStatements: unique symbol = Symbol.for(
  'sponsorship.DisplayStopStatements',
);
const RefundEstimator: unique symbol = Symbol.for(
  'sponsorship.RefundEstimator',
);
// 契約はworkers/sponsorshipにあり、infrastructure層と共有の部品だけが受け取る
const RefundSettlement: unique symbol = Symbol.for(
  'sponsorship.RefundSettlement',
);
const SponsorshipExport: unique symbol = Symbol.for(
  'sponsorship.SponsorshipExport',
);

export const SPONSORSHIP_PLATFORM_TYPES = Object.freeze({
  SponsorshipStore,
  EligibleProductReader,
  PlacementReader,
  SponsorshipOfferPolicy,
  SponsorshipFulfillment,
  NoticeScheduler,
  NoticeRequester,
  DisplayStopStore,
  DisplayStopStatements,
  RefundEstimator,
  RefundSettlement,
  SponsorshipExport,
});
