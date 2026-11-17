// backend-lib/core/year-tournamentの識別子がyear-tournament.の接頭辞を使うため、APIサーバーの識別子はyear-tournament.api.で分ける
const EveningBracketJob: unique symbol = Symbol.for(
  'year-tournament.api.EveningBracketJob',
);
const EntryFollowUpJob: unique symbol = Symbol.for(
  'year-tournament.api.EntryFollowUpJob',
);
const YearTournamentIncidentReporter: unique symbol = Symbol.for(
  'year-tournament.api.YearTournamentIncidentReporter',
);
const YearBoardReader: unique symbol = Symbol.for(
  'year-tournament.api.YearBoardReader',
);
const YearBracketReader: unique symbol = Symbol.for(
  'year-tournament.api.YearBracketReader',
);
const YearEntryPanelReader: unique symbol = Symbol.for(
  'year-tournament.api.YearEntryPanelReader',
);
const YearEntryCheckout: unique symbol = Symbol.for(
  'year-tournament.api.YearEntryCheckout',
);
const YearFinalDateService: unique symbol = Symbol.for(
  'year-tournament.api.YearFinalDateService',
);
const YearFinalDateWriter: unique symbol = Symbol.for(
  'year-tournament.api.YearFinalDateWriter',
);
const YearRelaunchConditionSource: unique symbol = Symbol.for(
  'year-tournament.api.YearRelaunchConditionSource',
);
const YearProductLockSource: unique symbol = Symbol.for(
  'year-tournament.api.YearProductLockSource',
);
const YearLaunchSummarySource: unique symbol = Symbol.for(
  'year-tournament.api.YearLaunchSummarySource',
);
const YearTrophySource: unique symbol = Symbol.for(
  'year-tournament.api.YearTrophySource',
);

export const YEAR_TOURNAMENT_API_TYPES = Object.freeze({
  EveningBracketJob,
  EntryFollowUpJob,
  YearTournamentIncidentReporter,
  YearBoardReader,
  YearBracketReader,
  YearEntryPanelReader,
  YearEntryCheckout,
  YearFinalDateService,
  YearFinalDateWriter,
  YearRelaunchConditionSource,
  YearProductLockSource,
  YearLaunchSummarySource,
  YearTrophySource,
});
