export interface HttpProbeWaitOptions {
  readonly timeoutMs: number;
  readonly expectStatus: number | 'any';
}

export interface HttpProbeResult {
  readonly reached: boolean;
  readonly lastStatus: number | undefined;
}

export interface HttpProbe {
  waitFor(url: string, opts: HttpProbeWaitOptions): Promise<HttpProbeResult>;
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
    timeoutMs: number,
  ): Promise<number | undefined> => {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel();
      return response.status;
    } catch {
      return undefined;
    }
  };

  return {
    waitFor: async (url, { timeoutMs, expectStatus }) => {
      const deadline = performance.now() + timeoutMs;
      let lastStatus: number | undefined;
      for (;;) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) return { reached: false, lastStatus };
        const status = await attempt(
          url,
          Math.min(attemptTimeoutMs, remaining),
        );
        if (status !== undefined) {
          if (matches(status, expectStatus)) {
            return { reached: true, lastStatus: status };
          }
          lastStatus = status;
        }
        const afterAttempt = deadline - performance.now();
        if (afterAttempt <= 0) return { reached: false, lastStatus };
        await Bun.sleep(Math.min(intervalMs, afterAttempt));
      }
    },
  };
}
