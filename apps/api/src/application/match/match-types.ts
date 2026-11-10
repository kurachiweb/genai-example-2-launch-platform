const UpvoteStore: unique symbol = Symbol.for('match.UpvoteStore');

const UpvoteService: unique symbol = Symbol.for('match.UpvoteService');

export const MATCH_TYPES = Object.freeze({
  UpvoteStore,
  UpvoteService,
});
