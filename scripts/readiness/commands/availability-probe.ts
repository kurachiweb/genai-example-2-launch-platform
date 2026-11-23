import { parseArgs } from 'node:util';

import {
  type Clock,
  createHttpPoller,
  type PollerFetch,
  type ProbeTarget,
  systemClock,
} from '../adapters/http-poller.ts';
import {
  formatProbeReport,
  probeSucceeded,
  tallyProbe,
} from '../core/probe-tally.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  type ReadinessCommandModule,
  type ReadinessRun,
  UsageError,
} from './shared/readiness-command.ts';

export interface AvailabilityProbeDeps {
  readonly fetch: PollerFetch;
  readonly clock: Clock;
}

type AppKey = 'client' | 'admin' | 'api' | 'event';

interface AppDefinition {
  readonly label: string;
  readonly path: string;
  readonly defaultOrigin: string;
}

// APIサーバーは外部へ公開APIと`/health`だけを出すため、api・eventは`/health`、管理者側は未ログインで応答する`/auth/login`を使う
const APPS: Readonly<Record<AppKey, AppDefinition>> = {
  client: {
    label: '利用者側',
    path: '/',
    defaultOrigin: 'http://localhost:48044',
  },
  admin: {
    label: '管理者側',
    path: '/auth/login',
    defaultOrigin: 'http://localhost:48045',
  },
  api: {
    label: 'APIサーバー',
    path: '/health',
    defaultOrigin: 'http://localhost:48042',
  },
  event: {
    label: 'イベントサーバー',
    path: '/health',
    defaultOrigin: 'http://localhost:48043',
  },
};

const APP_KEYS = Object.keys(APPS) as readonly AppKey[];
const DEFAULT_DURATION_SECONDS = 20 * 60;
const MS_PER_SECOND = 1_000;
const USER_AGENT = 'LaunchStadium-availability-probe/1.0';

interface ProbeOptions {
  readonly durationSeconds: number;
  readonly origins: Readonly<Record<AppKey, string>>;
}

const parseDurationSeconds = (value: string | undefined): number => {
  if (value === undefined) return DEFAULT_DURATION_SECONDS;
  const seconds = Number(value);
  if (!/^\d+$/.test(value) || seconds <= 0) {
    throw new UsageError(
      `--durationは1以上の整数の秒数で指定してください: ${value}`,
    );
  }
  return seconds;
};

const parseOrigin = (
  flag: string,
  value: string | undefined,
  fallback: string,
): string => {
  const raw = value ?? fallback;
  try {
    const { protocol } = new URL(raw);
    if (protocol === 'http:' || protocol === 'https:') return raw;
  } catch {
    // 下で使い方の誤りとして報告する
  }
  throw new UsageError(
    `${flag}にはhttpまたはhttpsのURLを指定してください: ${raw}`,
  );
};

const parseOptions = (args: readonly string[]): ProbeOptions => {
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: {
        duration: { type: 'string' },
        'client-url': { type: 'string' },
        'admin-url': { type: 'string' },
        'api-url': { type: 'string' },
        'event-url': { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
  return {
    durationSeconds: parseDurationSeconds(values.duration),
    origins: Object.fromEntries(
      APP_KEYS.map((key) => [
        key,
        parseOrigin(
          `--${key}-url`,
          values[`${key}-url`],
          APPS[key].defaultOrigin,
        ),
      ]),
    ) as Record<AppKey, string>,
  };
};

const targetsOf = (origins: ProbeOptions['origins']): readonly ProbeTarget[] =>
  APP_KEYS.map((key) => {
    const { label, path } = APPS[key];
    const url = new URL(path, origins[key]).href;
    return { name: `${label} ${url}`, url };
  });

export function createAvailabilityProbeCommand({
  fetch,
  clock,
}: AvailabilityProbeDeps): ReadinessCommandModule {
  const run: ReadinessRun = async (args, io) => {
    const { durationSeconds, origins } = parseOptions(args);
    const targets = targetsOf(origins);
    io.stdout.write(
      [
        `${String(durationSeconds)}秒間、1秒ごとに監視します。`,
        ...targets.map(({ name }) => `- ${name}`),
        '',
      ].join('\n'),
    );
    const poller = createHttpPoller({ fetch, clock, userAgent: USER_AGENT });
    const summaries = tallyProbe(
      await poller.poll({
        targets,
        durationMs: durationSeconds * MS_PER_SECOND,
      }),
    );
    io.stdout.write(`\n${formatProbeReport(summaries)}`);
    if (probeSucceeded(summaries)) return EXIT_SUCCESS;
    io.stderr.write(
      '失敗した応答があります。内訳は上の結果を確かめてください。\n',
    );
    return EXIT_FAILURE;
  };
  return { run };
}

export const { run } = createAvailabilityProbeCommand({
  fetch: (url, init) => fetch(url, init),
  clock: systemClock,
});
