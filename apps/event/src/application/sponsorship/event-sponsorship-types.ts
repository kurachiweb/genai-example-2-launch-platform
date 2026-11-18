// APIサーバーとbackend-lib/core/sponsorshipの識別子がsponsorship.とsponsorship.api.の接頭辞を使うため、イベントサーバーの識別子はsponsorship.event.で分ける
const NoticeDispatchHandler: unique symbol = Symbol.for(
  'sponsorship.event.NoticeDispatchHandler',
);
const NoticeClaimStore: unique symbol = Symbol.for(
  'sponsorship.event.NoticeClaimStore',
);
const PeriodEndSettlementHandler: unique symbol = Symbol.for(
  'sponsorship.event.PeriodEndSettlementHandler',
);
const PeriodEndSettlementCommitter: unique symbol = Symbol.for(
  'sponsorship.event.PeriodEndSettlementCommitter',
);
const AccountPurgeHandler: unique symbol = Symbol.for(
  'sponsorship.event.AccountPurgeHandler',
);
const ProductPurgeHandler: unique symbol = Symbol.for(
  'sponsorship.event.ProductPurgeHandler',
);
const SponsorshipPurgeStore: unique symbol = Symbol.for(
  'sponsorship.event.SponsorshipPurgeStore',
);

export const EVENT_SPONSORSHIP_TYPES = Object.freeze({
  NoticeDispatchHandler,
  NoticeClaimStore,
  PeriodEndSettlementHandler,
  PeriodEndSettlementCommitter,
  AccountPurgeHandler,
  ProductPurgeHandler,
  SponsorshipPurgeStore,
});
