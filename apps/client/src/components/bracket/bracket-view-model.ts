import type { BracketMatchProductFieldsFragment } from '../../graphql/generated/graphql.ts';
import type {
  BracketViewMatch,
  BracketViewNode,
  BracketViewProps,
  BracketViewRound,
  BracketViewSlot,
} from './bracket-view-props.ts';

export type BracketSlotDisplay =
  | { readonly kind: 'feed'; readonly label: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'number'; readonly participantNo: number }
  | { readonly kind: 'hidden' }
  | {
      readonly kind: 'product';
      readonly product: BracketMatchProductFieldsFragment;
    };

export type BracketSlotOutcome = 'won' | 'lost' | 'bye' | 'both-lost';

export type BracketMatchStatus = 'scheduled' | 'live' | 'tallying' | 'finished';

export type BracketChampionState =
  | {
      readonly kind: 'awarded';
      readonly product: BracketMatchProductFieldsFragment | null;
    }
  | { readonly kind: 'no-award' };

const BOTH_LOST_DECISIONS: ReadonlySet<BracketViewMatch['decision']> = new Set([
  'NO_VOTES',
  'BOTH_FORFEITED',
]);

const MATCH_STATUSES: Readonly<
  Record<BracketViewMatch['phase'], BracketMatchStatus>
> = {
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  TALLYING: 'tallying',
  FINISHED: 'finished',
};

// 未来の枠の表記・空の枠・予定を作る前の抽選番号・表示できないプロダクトの順に判定する
export function slotDisplayOf(
  node: BracketViewNode,
  slot: BracketViewSlot,
): BracketSlotDisplay {
  if (slot.feedLabel !== null) {
    return { kind: 'feed', label: slot.feedLabel };
  }
  if (slot.participantNo === null) {
    return { kind: 'empty' };
  }
  if (node.match === null) {
    return { kind: 'number', participantNo: slot.participantNo };
  }
  return slot.product === null
    ? { kind: 'hidden' }
    : { kind: 'product', product: slot.product };
}

export function slotOutcomeOf(
  node: BracketViewNode,
  slot: BracketViewSlot,
): BracketSlotOutcome | null {
  switch (slot.result) {
    case null:
      return null;
    case 'WON':
      return 'won';
    case 'BYE':
    case 'WALKOVER':
      return 'bye';
    case 'LOST':
      return BOTH_LOST_DECISIONS.has(node.match?.decision ?? null)
        ? 'both-lost'
        : 'lost';
  }
}

export function matchStatusOf(node: BracketViewNode): BracketMatchStatus {
  return node.match === null ? 'scheduled' : MATCH_STATUSES[node.match.phase];
}

const isSettled = (node: BracketViewNode): boolean =>
  node.match?.phase === 'FINISHED';

// 結果の確定していない位置を持つ最初のラウンド。すべて確定していれば最後のラウンド
export function defaultRoundOf(
  rounds: readonly BracketViewRound[],
): number | undefined {
  return (rounds.find(({ nodes }) => !nodes.every(isSettled)) ?? rounds.at(-1))
    ?.round;
}

export function championStateOf({
  champion,
  awarded,
  finished,
}: Pick<
  BracketViewProps,
  'champion' | 'awarded' | 'finished'
>): BracketChampionState | null {
  if (awarded) {
    return { kind: 'awarded', product: champion };
  }
  return finished ? { kind: 'no-award' } : null;
}
