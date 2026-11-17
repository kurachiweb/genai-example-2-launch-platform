import { EMPTY_WEEK_BOARD } from '../src/components/week-tournament/week-board-fixtures.ts';
import { ClientWeekTournamentBoardDocument } from '../src/graphql/generated/graphql.ts';

type Execute = (document: unknown, ...rest: unknown[]) => unknown;

// トップページの経路のテストは登録口の全ての区画を描くため、Weekトーナメントの区画の取得にはマッチの無い日の盤面を返し、他の取得をテストの偽物へ渡す。
// 実行の関数の差し替えの中で読み込むため、実行の関数を読み込むファイル(経路など)を読み込まない
export const withoutWeekTournamentMatches =
  (execute: Execute): Execute =>
  (document, ...rest) =>
    document === ClientWeekTournamentBoardDocument
      ? Promise.resolve({
          ok: true,
          data: { weekTournamentBoard: EMPTY_WEEK_BOARD },
        })
      : execute(document, ...rest);
