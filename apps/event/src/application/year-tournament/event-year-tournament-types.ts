// APIサーバーとbackend-lib/core/year-tournamentの識別子がyear-tournament.の接頭辞を使うため、イベントサーバーの識別子はyear-tournament.event.で分ける
const WeekChampionEntryHandler: unique symbol = Symbol.for(
  'year-tournament.event.WeekChampionEntryHandler',
);
const RoundProgressHandler: unique symbol = Symbol.for(
  'year-tournament.event.RoundProgressHandler',
);
const ProductEntryLossHandler: unique symbol = Symbol.for(
  'year-tournament.event.ProductEntryLossHandler',
);
const AccountEntryLossHandler: unique symbol = Symbol.for(
  'year-tournament.event.AccountEntryLossHandler',
);
const EntryUnlinkHandler: unique symbol = Symbol.for(
  'year-tournament.event.EntryUnlinkHandler',
);
const YearUltrasEntryExemptionHandler: unique symbol = Symbol.for(
  'year-tournament.event.YearUltrasEntryExemptionHandler',
);
const YearOpenEntryCheckoutExpiryHandler: unique symbol = Symbol.for(
  'year-tournament.event.YearOpenEntryCheckoutExpiryHandler',
);
const YearEntrySupplementProvider: unique symbol = Symbol.for(
  'year-tournament.event.YearEntrySupplementProvider',
);

export const EVENT_YEAR_TOURNAMENT_TYPES = Object.freeze({
  WeekChampionEntryHandler,
  RoundProgressHandler,
  ProductEntryLossHandler,
  AccountEntryLossHandler,
  EntryUnlinkHandler,
  YearUltrasEntryExemptionHandler,
  YearOpenEntryCheckoutExpiryHandler,
  YearEntrySupplementProvider,
});
