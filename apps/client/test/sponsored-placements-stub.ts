import { ClientSponsoredPlacementsDocument } from '../src/graphql/generated/graphql.ts';

type Execute = (document: unknown, ...rest: unknown[]) => unknown;

export const NO_SPONSORED_PLACEMENTS_RESULT = Object.freeze({
  ok: true,
  data: { sponsoredPlacements: { legend: [], gold: [], silver: [] } },
});

// 広告スペースを登録したページの経路のテストは全ての区画を描くため、広告の取得には0件を返し、他の取得をテストの偽物へ渡す。
// 実行の関数の差し替えの中で読み込むため、実行の関数を読み込むファイル(経路など)を読み込まない
export const withoutSponsoredPlacements =
  (execute: Execute): Execute =>
  (document, ...rest) =>
    document === ClientSponsoredPlacementsDocument
      ? Promise.resolve(NO_SPONSORED_PLACEMENTS_RESULT)
      : execute(document, ...rest);
