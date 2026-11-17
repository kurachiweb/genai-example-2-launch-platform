const YearTournamentStore: unique symbol = Symbol.for(
  'year-tournament.YearTournamentStore',
);
const YearEntryStore: unique symbol = Symbol.for(
  'year-tournament.YearEntryStore',
);
const YearCalendar: unique symbol = Symbol.for('year-tournament.YearCalendar');
const YearEntryRegistrar: unique symbol = Symbol.for(
  'year-tournament.YearEntryRegistrar',
);
const YearEntryOfferPolicy: unique symbol = Symbol.for(
  'year-tournament.YearEntryOfferPolicy',
);
const YearEntryFulfillment: unique symbol = Symbol.for(
  'year-tournament.YearEntryFulfillment',
);
const YearDrawService: unique symbol = Symbol.for(
  'year-tournament.YearDrawService',
);
const YearProgressionService: unique symbol = Symbol.for(
  'year-tournament.YearProgressionService',
);
const YearEntryFollowUp: unique symbol = Symbol.for(
  'year-tournament.YearEntryFollowUp',
);
const YearNotificationPublisher: unique symbol = Symbol.for(
  'year-tournament.YearNotificationPublisher',
);
const YearAwardExport: unique symbol = Symbol.for(
  'year-tournament.YearAwardExport',
);

export const YEAR_TOURNAMENT_TYPES = Object.freeze({
  YearTournamentStore,
  YearEntryStore,
  YearCalendar,
  YearEntryRegistrar,
  YearEntryOfferPolicy,
  YearEntryFulfillment,
  YearDrawService,
  YearProgressionService,
  YearEntryFollowUp,
  YearNotificationPublisher,
  YearAwardExport,
});
