export interface HttpProbeWaitOptions {
  readonly timeoutMs: number;
  readonly expectStatus: number | 'any';
}

export interface HttpProbe {
  waitFor(url: string, opts: HttpProbeWaitOptions): Promise<boolean>;
}

export interface HttpProbeOptions {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly intervalMs?: number;
  readonly attemptTimeoutMs?: number;
}

const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;

const matches = (
  status: number,
  expectStatus: HttpProbeWaitOptions['expectStatus'],
): boolean => expectStatus === 'any' || status === expectStatus;

export function createHttpProbe({
  fetch,
  intervalMs = DEFAULT_INTERVAL_MS,
  attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
}: HttpProbeOptions): HttpProbe {
  const attempt = async (
    url: string,
    expectStatus: HttpProbeWaitOptions['expectStatus'],
    timeoutMs: number,
  ): Promise<boolean> => {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel();
      return matches(response.status, expectStatus);
    } catch {
      return false;
    }
  };

  return {
    waitFor: async (url, { timeoutMs, expectStatus }) => {
      const deadline = performance.now() + timeoutMs;
      for (;;) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) return false;
        if (
          await attempt(
            url,
            expectStatus,
            Math.min(attemptTimeoutMs, remaining),
          )
        ) {
          return true;
        }
        const afterAttempt = deadline - performance.now();
        if (afterAttempt <= 0) return false;
        await Bun.sleep(Math.min(intervalMs, afterAttempt));
      }
    },
  };
}
