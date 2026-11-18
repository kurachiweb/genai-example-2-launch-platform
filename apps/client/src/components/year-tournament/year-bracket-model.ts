import type { ClientYearBracketQuery } from '../../graphql/generated/graphql.ts';
import { isTournamentBracketLive } from '../tournament/tournament-bracket-model.ts';

export type YearBracketView = NonNullable<
  ClientYearBracketQuery['yearBracket']
>;

const FINAL_STAGE = 'FINAL';

// 設定した決勝日はラウンドの遅れを含まないため、決勝のラウンドを並べていればその実施日(遅れの後は遅らせた後の日)を示す。開催中は全ラウンドを並べるため最後のラウンドが決勝で、終了した年は最後に記録したラウンドまでしか並べないため決勝の対戦を持つときだけ決勝とみなす
export const yearBracketFinalDateOf = (bracket: YearBracketView): string => {
  const last = bracket.rounds.at(-1);
  if (last === undefined) {
    return bracket.tournament.finalDate;
  }
  const isFinalRound =
    isTournamentBracketLive(bracket) ||
    last.nodes.some(({ match }) => match?.stage === FINAL_STAGE);
  return isFinalRound ? last.date : bracket.tournament.finalDate;
};
