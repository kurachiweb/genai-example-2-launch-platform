const UpvoteStore: unique symbol = Symbol.for('match.UpvoteStore');

const UpvoteService: unique symbol = Symbol.for('match.UpvoteService');

const AccountMatchClosureSyncHandler: unique symbol = Symbol.for(
  'match.AccountMatchClosureSyncHandler',
);

const ProductMatchClosureSyncHandler: unique symbol = Symbol.for(
  'match.ProductMatchClosureSyncHandler',
);

const SettlementStore: unique symbol = Symbol.for('match.SettlementStore');

const MatchSettlement: unique symbol = Symbol.for('match.MatchSettlement');

const PairingStore: unique symbol = Symbol.for('match.PairingStore');

const RandomSource: unique symbol = Symbol.for('match.RandomSource');

const QualifierPairingService: unique symbol = Symbol.for(
  'match.QualifierPairingService',
);

const KickoffStore: unique symbol = Symbol.for('match.KickoffStore');

const EntryEligibilityChecker: unique symbol = Symbol.for(
  'match.EntryEligibilityChecker',
);

const MatchIncidentReporter: unique symbol = Symbol.for(
  'match.MatchIncidentReporter',
);

const MatchKickoff: unique symbol = Symbol.for('match.MatchKickoff');

const MatchSettlementJob: unique symbol = Symbol.for(
  'match.MatchSettlementJob',
);

const QualifierPairingJob: unique symbol = Symbol.for(
  'match.QualifierPairingJob',
);

const MatchKickoffJob: unique symbol = Symbol.for('match.MatchKickoffJob');

export const MATCH_TYPES = Object.freeze({
  UpvoteStore,
  UpvoteService,
  AccountMatchClosureSyncHandler,
  ProductMatchClosureSyncHandler,
  SettlementStore,
  MatchSettlement,
  PairingStore,
  RandomSource,
  QualifierPairingService,
  KickoffStore,
  EntryEligibilityChecker,
  MatchIncidentReporter,
  MatchKickoff,
  MatchSettlementJob,
  QualifierPairingJob,
  MatchKickoffJob,
});
