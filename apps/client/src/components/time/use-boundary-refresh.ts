import { useEffect, useLayoutEffect, useRef } from 'react';

// 境界の直後にサーバーが返す状態が境界の後のものになるよう、閲覧者とサーバーの時計の小さなずれの分だけ遅らせて取り直す
export const BOUNDARY_REFRESH_DELAY_MS = 1000;

// setTimeoutは2^31-1ミリ秒を超える待ちを即時に実行するため、それより先の境界は上限で起きて待ち直す
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const BOUNDARY_SEPARATOR = ' ';

const nextBoundaryOf = (boundaryKey: string, now: number): number | null => {
  const upcoming = boundaryKey
    .split(BOUNDARY_SEPARATOR)
    .filter((value) => value !== '')
    .map((value) => new Date(value).getTime() + BOUNDARY_REFRESH_DELAY_MS)
    .filter((at) => at > now);
  return upcoming.length === 0 ? null : Math.min(...upcoming);
};

// 表示中の画面が業務時刻の境界(ISO 8601の日時)を越えた時に、その時刻のタイマーで取り直す。過ぎた境界は扱わず、取り直しても境界の並びが変わらない時は残りの境界のタイマーを掛け直す
export function useBoundaryRefresh(
  boundaries: readonly string[],
  refresh: () => void,
): void {
  const refreshRef = useRef(refresh);
  // 境界の並びは描画ごとに新しい配列になるため、同じ境界の間はタイマーを掛け直さないよう文字列で比べる
  const boundaryKey = boundaries.toSorted().join(BOUNDARY_SEPARATOR);

  useLayoutEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      const now = Date.now();
      const next = nextBoundaryOf(boundaryKey, now);
      if (next === null) {
        return;
      }
      const delay = next - now;
      const reachable = delay <= MAX_TIMER_DELAY_MS;
      timer = setTimeout(
        () => {
          if (reachable) {
            refreshRef.current();
          }
          schedule();
        },
        reachable ? delay : MAX_TIMER_DELAY_MS,
      );
    };
    schedule();
    return () => {
      clearTimeout(timer);
    };
  }, [boundaryKey]);
}
