// backend-lib/core/week-tournamentの識別子がweek-tournament.の接頭辞を使うため、APIサーバーの識別子はweek-tournament.api.で分ける
const EveningBracketJob: unique symbol = Symbol.for(
  'week-tournament.api.EveningBracketJob',
);
const EntryFollowUpJob: unique symbol = Symbol.for(
  'week-tournament.api.EntryFollowUpJob',
);
const WeekTournamentIncidentReporter: unique symbol = Symbol.for(
  'week-tournament.api.WeekTournamentIncidentReporter',
);
const WeekBoardReader: unique symbol = Symbol.for(
  'week-tournament.api.WeekBoardReader',
);
const WeekBracketReader: unique symbol = Symbol.for(
  'week-tournament.api.WeekBracketReader',
);
const WeekEntryPanelReader: unique symbol = Symbol.for(
  'week-tournament.api.WeekEntryPanelReader',
);
const WeekEntryCheckout: unique symbol = Symbol.for(
  'week-tournament.api.WeekEntryCheckout',
);
const WeekRelaunchConditionSource: unique symbol = Symbol.for(
  'week-tournament.api.WeekRelaunchConditionSource',
);
const WeekProductLockSource: unique symbol = Symbol.for(
  'week-tournament.api.WeekProductLockSource',
);
const WeekLaunchSummarySource: unique symbol = Symbol.for(
  'week-tournament.api.WeekLaunchSummarySource',
);
const WeekTrophySource: unique symbol = Symbol.for(
  'week-tournament.api.WeekTrophySource',
);
const TrophySources: unique symbol = Symbol.for(
  'week-tournament.api.TrophySources',
);
const ProductTrophyReader: unique symbol = Symbol.for(
  'week-tournament.api.ProductTrophyReader',
);

export const WEEK_TOURNAMENT_API_TYPES = Object.freeze({
  EveningBracketJob,
  EntryFollowUpJob,
  WeekTournamentIncidentReporter,
  WeekBoardReader,
  WeekBracketReader,
  WeekEntryPanelReader,
  WeekEntryCheckout,
  WeekRelaunchConditionSource,
  WeekProductLockSource,
  WeekLaunchSummarySource,
  WeekTrophySource,
  TrophySources,
  ProductTrophyReader,
});
