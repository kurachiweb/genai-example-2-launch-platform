import type { Resolvers } from '../../generated/resolvers-types.ts';
import { MATCH_ENTRY_RESULT_VALUES } from '../match/mappers.ts';

// ブラケットの表示の組み立ての値だけを読み、WeekとYearのどちらの照会の型にも依存しない
export const bracketViewResolvers = {
  BracketRound: {
    nodes: (round) => [...round.nodes],
  },
  BracketNode: {
    slots: (node) => [...node.slots],
  },
  BracketSlot: {
    result: (slot) =>
      slot.result === null ? null : MATCH_ENTRY_RESULT_VALUES[slot.result],
  },
} satisfies Resolvers;
