// APIサーバーとbackend-lib/core/week-tournamentの識別子がweek-tournament.の接頭辞を使うため、イベントサーバーの識別子はweek-tournament.event.で分ける
const QualifierEntryHandler: unique symbol = Symbol.for(
  'week-tournament.event.QualifierEntryHandler',
);
const RoundProgressHandler: unique symbol = Symbol.for(
  'week-tournament.event.RoundProgressHandler',
);
const ProductEntryLossHandler: unique symbol = Symbol.for(
  'week-tournament.event.ProductEntryLossHandler',
);
const AccountEntryLossHandler: unique symbol = Symbol.for(
  'week-tournament.event.AccountEntryLossHandler',
);
const EntryUnlinkHandler: unique symbol = Symbol.for(
  'week-tournament.event.EntryUnlinkHandler',
);
const WeekUltrasEntryExemptionHandler: unique symbol = Symbol.for(
  'week-tournament.event.WeekUltrasEntryExemptionHandler',
);
const WeekOpenEntryCheckoutExpiryHandler: unique symbol = Symbol.for(
  'week-tournament.event.WeekOpenEntryCheckoutExpiryHandler',
);
const WeekEntrySupplementProvider: unique symbol = Symbol.for(
  'week-tournament.event.WeekEntrySupplementProvider',
);

export const EVENT_WEEK_TOURNAMENT_TYPES = Object.freeze({
  QualifierEntryHandler,
  RoundProgressHandler,
  ProductEntryLossHandler,
  AccountEntryLossHandler,
  EntryUnlinkHandler,
  WeekUltrasEntryExemptionHandler,
  WeekOpenEntryCheckoutExpiryHandler,
  WeekEntrySupplementProvider,
});
