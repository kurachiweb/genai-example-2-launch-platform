const WeekTournamentStore: unique symbol = Symbol.for(
  'week-tournament.WeekTournamentStore',
);
const WeekEntryRegistrar: unique symbol = Symbol.for(
  'week-tournament.WeekEntryRegistrar',
);
const WeekEntryOfferPolicy: unique symbol = Symbol.for(
  'week-tournament.WeekEntryOfferPolicy',
);
const WeekEntryFulfillment: unique symbol = Symbol.for(
  'week-tournament.WeekEntryFulfillment',
);
const WeekDrawService: unique symbol = Symbol.for(
  'week-tournament.WeekDrawService',
);
const WeekProgressionService: unique symbol = Symbol.for(
  'week-tournament.WeekProgressionService',
);
const WeekEntryFollowUp: unique symbol = Symbol.for(
  'week-tournament.WeekEntryFollowUp',
);
const WeekNotificationPublisher: unique symbol = Symbol.for(
  'week-tournament.WeekNotificationPublisher',
);
const WeekChampionDirectory: unique symbol = Symbol.for(
  'week-tournament.WeekChampionDirectory',
);
const WeekAwardExport: unique symbol = Symbol.for(
  'week-tournament.WeekAwardExport',
);

export const WEEK_TOURNAMENT_TYPES = Object.freeze({
  WeekTournamentStore,
  WeekEntryRegistrar,
  WeekEntryOfferPolicy,
  WeekEntryFulfillment,
  WeekDrawService,
  WeekProgressionService,
  WeekEntryFollowUp,
  WeekNotificationPublisher,
  WeekChampionDirectory,
  WeekAwardExport,
});
