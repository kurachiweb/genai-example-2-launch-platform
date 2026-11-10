const UpvoteStore: unique symbol = Symbol.for('match.UpvoteStore');

const UpvoteService: unique symbol = Symbol.for('match.UpvoteService');

const AccountMatchClosureSyncHandler: unique symbol = Symbol.for(
  'match.AccountMatchClosureSyncHandler',
);

const ProductMatchClosureSyncHandler: unique symbol = Symbol.for(
  'match.ProductMatchClosureSyncHandler',
);

export const MATCH_TYPES = Object.freeze({
  UpvoteStore,
  UpvoteService,
  AccountMatchClosureSyncHandler,
  ProductMatchClosureSyncHandler,
});
