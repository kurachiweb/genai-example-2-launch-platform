import { EMPTY_YEAR_BOARD } from '../src/components/year-tournament/year-tournament-fixtures.ts';
import { ClientYearTournamentBoardDocument } from '../src/graphql/generated/graphql.ts';

type Execute = (document: unknown, ...rest: unknown[]) => unknown;

// トップページの経路のテストは登録口の全ての区画を描くため、Yearトーナメントの区画の取得にはマッチの無い日の盤面を返し、他の取得をテストの偽物へ渡す。
// 実行の関数の差し替えの中で読み込むため、実行の関数を読み込むファイル(経路など)を読み込まない
export const withoutYearTournamentMatches =
  (execute: Execute): Execute =>
  (document, ...rest) =>
    document === ClientYearTournamentBoardDocument
      ? Promise.resolve({
          ok: true,
          data: { yearTournamentBoard: EMPTY_YEAR_BOARD },
        })
      : execute(document, ...rest);
