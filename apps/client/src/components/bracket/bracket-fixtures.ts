import type { BracketMatchProductFieldsFragment } from '../../graphql/generated/graphql.ts';
import type {
  BracketViewMatch,
  BracketViewNode,
  BracketViewRound,
  BracketViewSlot,
} from './bracket-view-props.ts';

const serial = (value: number): string => String(value).padStart(4, '0');

// n番目のプロダクト。名称は「Bracket Product <n>」で、既定はディレクトリに掲載されている
export const bracketProductOf = (
  n: number,
  overrides: Partial<BracketMatchProductFieldsFragment> = {},
): BracketMatchProductFieldsFragment => ({
  handle: `bracket-product-${String(n)}`,
  name: `Bracket Product ${String(n)}`,
  tagline: 'ブラケットの表示を確かめるプロダクト',
  category: {
    id: '01JD0CATEGORY0000000000001',
    name: '開発ツール',
    handle: 'dev-tools',
  },
  websiteUrl: `https://bracket-product-${String(n)}.example/`,
  logo: null,
  listed: true,
  ...overrides,
});

export const EMPTY_BRACKET_SLOT: BracketViewSlot = Object.freeze({
  participantNo: null,
  seed: null,
  feedLabel: null,
  product: null,
  upvoteCount: null,
  result: null,
});

// 予定を作ったマッチの側。既定は抽選番号nのプロダクトでUpvote数0・結果の確定の前
export const playedSlotOf = (
  participantNo: number,
  overrides: Partial<BracketViewSlot> = {},
): BracketViewSlot => ({
  ...EMPTY_BRACKET_SLOT,
  participantNo,
  product: bracketProductOf(participantNo),
  upvoteCount: 0,
  ...overrides,
});

// 予定を作っていない位置の側。勝ち上がる側が決まっていればその抽選番号を持つ
export const feedSlotOf = (
  feedLabel: string,
  overrides: Partial<BracketViewSlot> = {},
): BracketViewSlot => ({ ...EMPTY_BRACKET_SLOT, feedLabel, ...overrides });

export const bracketMatchOf = (
  id: number,
  overrides: Partial<BracketViewMatch> = {},
): BracketViewMatch => ({
  id: `01JD0MATCH0000000000K0${serial(id)}`,
  kind: 'WEEK',
  round: 1,
  stage: null,
  date: '2026-11-10',
  phase: 'SCHEDULED',
  decision: null,
  endedEarly: false,
  ...overrides,
});

export const bracketNodeOf = (
  position: number,
  match: BracketViewMatch | null,
  slots: readonly [BracketViewSlot, BracketViewSlot],
): BracketViewNode => ({ position, match, slots: [...slots] });

export const bracketRoundOf = (
  round: number,
  name: string,
  date: string,
  nodes: readonly BracketViewNode[],
): BracketViewRound => ({ round, name, date, nodes: [...nodes] });

// 参加6・シード2のブラケットの1回戦。第1試合は抽選番号3の勝利、第2試合は両者敗北
export const IN_PROGRESS_FIRST_ROUND: BracketViewRound = bracketRoundOf(
  1,
  '1回戦',
  '2026-11-10',
  [
    bracketNodeOf(
      1,
      bracketMatchOf(1, { phase: 'FINISHED', decision: 'VOTES' }),
      [
        playedSlotOf(3, { upvoteCount: 12, result: 'WON' }),
        playedSlotOf(4, { upvoteCount: 9, result: 'LOST' }),
      ],
    ),
    bracketNodeOf(
      2,
      bracketMatchOf(2, { phase: 'FINISHED', decision: 'NO_VOTES' }),
      [
        playedSlotOf(5, { result: 'LOST' }),
        playedSlotOf(6, { result: 'LOST' }),
      ],
    ),
  ],
);

// 準決勝。第1試合はシード1と抽選番号3のマッチ中、第2試合はシード2の不戦勝
export const IN_PROGRESS_SEMIFINAL: BracketViewRound = bracketRoundOf(
  2,
  '準決勝',
  '2026-11-11',
  [
    bracketNodeOf(
      1,
      bracketMatchOf(3, {
        round: 2,
        stage: 'SEMIFINAL',
        date: '2026-11-11',
        phase: 'LIVE',
      }),
      [
        playedSlotOf(1, { seed: 1, upvoteCount: 5 }),
        playedSlotOf(3, { upvoteCount: 7 }),
      ],
    ),
    bracketNodeOf(
      2,
      bracketMatchOf(4, {
        round: 2,
        stage: 'SEMIFINAL',
        date: '2026-11-11',
        phase: 'FINISHED',
        decision: 'BYE',
      }),
      [playedSlotOf(2, { seed: 2, result: 'BYE' }), EMPTY_BRACKET_SLOT],
    ),
  ],
);

// 参加6・シード2のブラケット。決勝は予定を作る前
export const IN_PROGRESS_ROUNDS: readonly BracketViewRound[] = Object.freeze([
  IN_PROGRESS_FIRST_ROUND,
  IN_PROGRESS_SEMIFINAL,
  bracketRoundOf(3, '決勝', '2026-11-12', [
    bracketNodeOf(1, null, [
      feedSlotOf('準決勝第1試合の勝者'),
      feedSlotOf('準決勝第2試合の勝者', { participantNo: 2, seed: 2 }),
    ]),
  ]),
]);
