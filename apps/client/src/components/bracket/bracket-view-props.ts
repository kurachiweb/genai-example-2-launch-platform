import type {
  BracketMatchProductFieldsFragment,
  BracketRoundFieldsFragment,
} from '../../graphql/generated/graphql.ts';

export interface BracketViewProps {
  readonly rounds: readonly BracketRoundFieldsFragment[];
  readonly champion: BracketMatchProductFieldsFragment | null;
  // 真でchampionがnullなら、表示できないプロダクトの受賞として示す(参加1でroundsが空の場合を含む)
  readonly awarded: boolean;
  // awardedが偽のとき、真なら受賞なしで終えたことを示す
  readonly finished: boolean;
}

export type BracketViewRound = BracketViewProps['rounds'][number];

export type BracketViewNode = BracketViewRound['nodes'][number];

export type BracketViewSlot = BracketViewNode['slots'][number];

export type BracketViewMatch = NonNullable<BracketViewNode['match']>;
