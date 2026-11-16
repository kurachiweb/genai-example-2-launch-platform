const BracketStore: unique symbol = Symbol.for('tournament.BracketStore');
const BracketDraw: unique symbol = Symbol.for('tournament.BracketDraw');
const BracketProgression: unique symbol = Symbol.for(
  'tournament.BracketProgression',
);

export const TOURNAMENT_PLATFORM_TYPES = Object.freeze({
  BracketStore,
  BracketDraw,
  BracketProgression,
});
