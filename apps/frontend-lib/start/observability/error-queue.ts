import {
  GraphQLClientError,
  isExpectedFailure,
} from '../../utilities/graphql/graphql-result.ts';

export const MAX_QUEUED_ERRORS = 10;

export type ReportSource = 'loader' | 'render' | 'graphql';

export interface BrowserErrorQueue {
  readonly enqueue: (error: unknown) => void;
  readonly flush: (send: (error: unknown) => void) => void;
}

// 中継が上流に届かなかった時は、中継の処理が元の例外をサーバー側で送っている。同じ失敗から作られた別のオブジェクトを再び送ると二重になるため、送信元を中継に絞る
const RELAY_REPORTED_ERROR_CODES: ReadonlySet<string> = new Set([
  'upstream_unavailable',
  'upstream_timeout',
]);

export const isReportableFailure = (error: unknown): boolean =>
  !isExpectedFailure(error) &&
  !(
    error instanceof GraphQLClientError &&
    RELAY_REPORTED_ERROR_CODES.has(error.code)
  );

// 同じ例外はloaderの失敗・描画の失敗・GraphQLの失敗として複数の経路から届くため、オブジェクトの同一性で2回目を除く。同一性を持たない値は区別できないため毎回通す
export const createFirstReportFilter = (): ((error: unknown) => boolean) => {
  const reported = new WeakSet<object>();
  return (error) => {
    if (
      (typeof error !== 'object' || error === null) &&
      typeof error !== 'function'
    ) {
      return true;
    }
    if (reported.has(error)) {
      return false;
    }
    reported.add(error);
    return true;
  };
};

const sendSafely = (send: (error: unknown) => void, error: unknown): void => {
  try {
    send(error);
  } catch {
    // 送信の失敗を画面の処理へ伝えない。ブラウザには失敗を伝える先が他に無く、consoleへも出さない
  }
};

export const createBrowserErrorQueue = (
  limit: number = MAX_QUEUED_ERRORS,
): BrowserErrorQueue => {
  const isFirstReport = createFirstReportFilter();
  let pending: readonly unknown[] = [];
  let sender: ((error: unknown) => void) | undefined;
  return {
    enqueue: (error) => {
      if (!isReportableFailure(error)) {
        return;
      }
      if (sender !== undefined) {
        if (isFirstReport(error)) {
          sendSafely(sender, error);
        }
        return;
      }
      // 上限で捨てた例外は送っていないため、2回目として除く対象に記録しない
      if (pending.length >= limit || !isFirstReport(error)) {
        return;
      }
      pending = [...pending, error];
    },
    flush: (send) => {
      if (sender !== undefined) {
        return;
      }
      sender = send;
      const queued = pending;
      pending = [];
      for (const error of queued) {
        sendSafely(send, error);
      }
    },
  };
};
