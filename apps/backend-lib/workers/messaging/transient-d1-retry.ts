import { getAppLogger } from '../../core/logging/app-logger.ts';

// ロックの競合はすぐに解けることが多いため、Queuesの再試行(数十秒以上の間隔)に回す前に、短い間隔でやり直す
export const TRANSIENT_D1_RETRY_DELAYS_MS = Object.freeze([100, 400, 1000]);

// ロックの競合(SQLITE_BUSY)と、D1が内部エラーとして返す失敗は、文が実行されずに終わっている
const TRANSIENT_D1_MESSAGE_PATTERNS = Object.freeze([
  /SQLITE_BUSY/u,
  /D1_ERROR: .*internal error; reference = /u,
]);

const MAX_CAUSE_DEPTH = 10;

const logger = getAppLogger(['event', 'queue', 'consumer']);

export function isTransientD1Error(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!(current instanceof Error)) {
      return false;
    }
    const { message } = current;
    if (
      TRANSIENT_D1_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

const sleepFor = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// 処理は重複配信に備えて冪等に書かれているため、同じ配信の中で最初からやり直してよい
export async function retryTransientD1<T>(
  run: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = sleepFor,
): Promise<T> {
  for (const delayMs of TRANSIENT_D1_RETRY_DELAYS_MS) {
    try {
      return await run();
    } catch (error) {
      if (!isTransientD1Error(error)) {
        throw error;
      }
      logger.info('D1の一時的な失敗のため、同じ配信の中でやり直します', {
        error,
        delayMs,
      });
      await sleep(delayMs);
    }
  }
  return run();
}
