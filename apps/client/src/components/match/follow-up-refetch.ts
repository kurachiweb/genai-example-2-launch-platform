// 境界の時刻の直後に結果の確定やマッチの開始を待つ取り直しの上限。自動更新がオフでも、この回数までは取り直す
export const FOLLOW_UP_REFETCH_LIMIT = 10;

export interface QueryUpdateCounts {
  readonly dataUpdateCount: number;
  readonly errorUpdateCount: number;
}

export const updateCountOf = (state: QueryUpdateCounts | undefined): number =>
  state === undefined ? 0 : state.dataUpdateCount + state.errorUpdateCount;
