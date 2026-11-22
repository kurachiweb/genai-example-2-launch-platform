import { useCallback, useEffect, useRef } from 'react';

import { isReportCaseRefreshFailure } from './use-report-case-mutation.ts';

export interface DeferredReportCaseRefresh {
  // 取り直す失敗なら持っておき、真を返す
  readonly defer: (error: unknown) => boolean;
  // 持っている失敗の取り直しを行う。ダイアログを閉じた時に呼ぶ
  readonly flush: () => void;
}

// 詳細のページのダイアログは、取り直しで案件が替わる・消えると失敗の文言を読む前に画面が変わるため、取り直す失敗の取り直しを閉じるまで遅らせる。閉じずに外れた時も外れる時に取り直す
export function useDeferredReportCaseRefresh(
  refreshAfter: (error: unknown) => Promise<void>,
): DeferredReportCaseRefresh {
  const failureRef = useRef<unknown>(undefined);
  const flush = useCallback((): void => {
    const failure = failureRef.current;
    failureRef.current = undefined;
    if (failure !== undefined) {
      void refreshAfter(failure);
    }
  }, [refreshAfter]);
  useEffect(() => flush, [flush]);

  const defer = (error: unknown): boolean => {
    if (!isReportCaseRefreshFailure(error)) {
      return false;
    }
    failureRef.current = error;
    return true;
  };

  return { defer, flush };
}
