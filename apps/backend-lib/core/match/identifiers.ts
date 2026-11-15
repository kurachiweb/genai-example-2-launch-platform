const MatchDirectory: unique symbol = Symbol.for('match.MatchDirectory');
const SupporterDirectory: unique symbol = Symbol.for(
  'match.SupporterDirectory',
);
const MatchScheduler: unique symbol = Symbol.for('match.MatchScheduler');
const MatchEventStore: unique symbol = Symbol.for('match.MatchEventStore');
const MatchEventDispatcher: unique symbol = Symbol.for(
  'match.MatchEventDispatcher',
);
const MatchExport: unique symbol = Symbol.for('match.MatchExport');
const UpvoteExport: unique symbol = Symbol.for('match.UpvoteExport');

export const MATCH_PLATFORM_TYPES = Object.freeze({
  MatchDirectory,
  SupporterDirectory,
  MatchScheduler,
  MatchEventStore,
  MatchEventDispatcher,
  MatchExport,
  UpvoteExport,
});
