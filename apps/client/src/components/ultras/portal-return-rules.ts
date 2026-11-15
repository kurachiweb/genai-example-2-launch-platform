// Customer Portalでの操作はWebhookで遅れて反映されるため、戻った直後はこの間隔で加入状態を確かめ直す
export const PORTAL_RETURN_RECHECK_INTERVAL_MS = 5000;

// 確かめ直しの回数の上限。達した後はページの開き直しを案内する
export const PORTAL_RETURN_RECHECK_LIMIT = 12;

export interface QueryUpdateCounts {
  readonly dataUpdateCount: number;
  readonly errorUpdateCount: number;
}

// 失敗した取り直しも1回に数え、失敗が続いても上限で止まるようにする
export const updateCountOf = (state: QueryUpdateCounts | undefined): number =>
  state === undefined ? 0 : state.dataUpdateCount + state.errorUpdateCount;

export const portalRechecksRemain = (
  updateCount: number,
  baseline: number,
): boolean => updateCount - baseline < PORTAL_RETURN_RECHECK_LIMIT;

export const portalRecheckIntervalOf = (
  updateCount: number,
  baseline: number,
): number | false =>
  portalRechecksRemain(updateCount, baseline)
    ? PORTAL_RETURN_RECHECK_INTERVAL_MS
    : false;
