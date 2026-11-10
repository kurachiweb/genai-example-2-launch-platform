const UpvoteStore: unique symbol = Symbol.for('match.UpvoteStore');

const UpvoteService: unique symbol = Symbol.for('match.UpvoteService');

const AccountMatchClosureSyncHandler: unique symbol = Symbol.for(
  'match.AccountMatchClosureSyncHandler',
);

export const MATCH_TYPES = Object.freeze({
  UpvoteStore,
  UpvoteService,
  AccountMatchClosureSyncHandler,
});
