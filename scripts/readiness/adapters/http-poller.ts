import type { ProbeObservation } from '../core/probe-tally.ts';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => Bun.sleep(ms),
};

export type PollerFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ProbeTarget {
  readonly name: string;
  readonly url: string;
}

export interface PollOptions {
  readonly targets: readonly ProbeTarget[];
  readonly durationMs: number;
}

export interface HttpPoller {
  poll(options: PollOptions): Promise<readonly ProbeObservation[]>;
}

export interface HttpPollerOptions {
  readonly fetch: PollerFetch;
  readonly clock: Clock;
  readonly userAgent: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERVAL_MS = 1_000;

const TIMEOUT_ERROR_NAMES: ReadonlySet<string> = new Set([
  'TimeoutError',
  'AbortError',
]);

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && TIMEOUT_ERROR_NAMES.has(error.name);

export function createHttpPoller({
  fetch,
  clock,
  userAgent,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
}: HttpPollerOptions): HttpPoller {
  const requestStatus = async (
    url: string,
  ): Promise<ProbeObservation['status']> => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': userAgent },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel().catch(() => undefined);
      return response.status;
    } catch (error) {
      return isTimeout(error) ? 'timeout' : 'network-error';
    }
  };

  const observe = async ({
    name,
    url,
  }: ProbeTarget): Promise<ProbeObservation> => {
    const startedAt = clock.now();
    const status = await requestStatus(url);
    return {
      target: name,
      at: new Date(startedAt).toISOString(),
      status,
      durationMs: clock.now() - startedAt,
    };
  };

  return {
    // 応答の遅い対象が次の要求を遅らせないよう、要求は待たずに1秒ごとの刻みで送り、最後に全ての応答を待つ
    poll: async ({ targets, durationMs }) => {
      const startedAt = clock.now();
      const inflight: Promise<ProbeObservation>[] = [];
      for (let tick = 0; tick * intervalMs < durationMs; tick += 1) {
        await clock.sleep(startedAt + tick * intervalMs - clock.now());
        inflight.push(...targets.map(observe));
      }
      return Promise.all(inflight);
    },
  };
}
