// APIサーバーとbackend-lib/core/matchの識別子がmatch.の接頭辞を使うため、イベントサーバーの識別子はmatch.event.で分ける
const MatchEventRunner: unique symbol = Symbol.for(
  'match.event.MatchEventRunner',
);
const QualifierOutcomeHandler: unique symbol = Symbol.for(
  'match.event.QualifierOutcomeHandler',
);
const AccountDecisionFollowUpHandler: unique symbol = Symbol.for(
  'match.event.AccountDecisionFollowUpHandler',
);
const ProductDecisionFollowUpHandler: unique symbol = Symbol.for(
  'match.event.ProductDecisionFollowUpHandler',
);
const MatchPurgeStore: unique symbol = Symbol.for(
  'match.event.MatchPurgeStore',
);
const UpvoteErasureHandler: unique symbol = Symbol.for(
  'match.event.UpvoteErasureHandler',
);
const EntryUnlinkHandler: unique symbol = Symbol.for(
  'match.event.EntryUnlinkHandler',
);

export const EVENT_MATCH_TYPES = Object.freeze({
  MatchEventRunner,
  QualifierOutcomeHandler,
  AccountDecisionFollowUpHandler,
  ProductDecisionFollowUpHandler,
  MatchPurgeStore,
  UpvoteErasureHandler,
  EntryUnlinkHandler,
});
