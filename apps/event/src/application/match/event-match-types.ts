// APIサーバーとbackend-lib/core/matchの識別子がmatch.の接頭辞を使うため、イベントサーバーの識別子はmatch.event.で分ける
const MatchEventRunner: unique symbol = Symbol.for(
  'match.event.MatchEventRunner',
);

export const EVENT_MATCH_TYPES = Object.freeze({
  MatchEventRunner,
});
