export const ROUTE_NAMES = [
  'top',
  'directory',
  'product',
  'profile',
  'help',
  'pricing',
  'public-api',
] as const;

export type RouteName = (typeof ROUTE_NAMES)[number];

export interface VisitStep {
  readonly route: RouteName;
  readonly url: string;
}

export interface LoadSettings {
  readonly clientBaseUrl: string;
  readonly apiBaseUrl: string;
  readonly productHandles: readonly string[];
  readonly profileHandles: readonly string[];
  readonly vus: number;
  readonly duration: string;
  readonly summaryPath: string | undefined;
}

export type StatusClass = 'ok' | 'server_error' | 'rate_limited' | 'unexpected';

export interface LatencyRow {
  readonly operation: string;
  readonly samples: number;
  readonly p95Ms: number;
}

export const P95_THRESHOLD_MS = 300;

const MIN_WAIT_SECONDS = 3;
const MAX_WAIT_SECONDS = 15;
const DEFAULT_VUS = 20;
const MAX_VUS = 100;
const DEFAULT_DURATION = '15m';
const HTTP_OK = 200;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;
const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const BASE_URL_PATTERN = /^https?:\/\/[^/?#@\s]+$/u;
const POSITIVE_INTEGER = /^[1-9]\d*$/u;
const DURATION_PATTERN = /^[1-9]\d*[smh]$/u;

export const LOAD_THRESHOLDS = {
  server_errors: ['rate==0'],
  rate_limited_responses: ['count==0'],
  unexpected_responses: ['count==0'],
  http_req_duration: [`p(95)<${String(P95_THRESHOLD_MS)}`],
} as const;

export interface LoadOptions {
  readonly scenarios: {
    readonly browse: {
      readonly executor: 'constant-vus';
      readonly vus: number;
      readonly duration: string;
    };
  };
  readonly thresholds: typeof LOAD_THRESHOLDS;
  readonly summaryTrendStats: readonly string[];
}

type Env = Readonly<Record<string, string | undefined>>;

const requiredOf = (env: Env, name: string): string => {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`環境変数${name}を指定してください`);
  }
  return value;
};

const baseUrlOf = (env: Env, name: string): string => {
  const value = requiredOf(env, name).replace(/\/$/u, '');
  if (!BASE_URL_PATTERN.test(value)) {
    throw new Error(
      `環境変数${name}はパスを含まない http(s)のオリジンで指定してください: ${value}`,
    );
  }
  return value;
};

const handlesOf = (env: Env, name: string): readonly string[] => {
  const handles = requiredOf(env, name)
    .split(',')
    .map((handle) => handle.trim())
    .filter((handle) => handle !== '');
  if (handles.length === 0) {
    throw new Error(`環境変数${name}に見本のハンドルを1つ以上指定してください`);
  }
  const invalid = handles.find((handle) => !HANDLE_PATTERN.test(handle));
  if (invalid !== undefined) {
    throw new Error(
      `環境変数${name}にハンドルとして不正な値があります: ${invalid}`,
    );
  }
  return handles;
};

const vusOf = (env: Env): number => {
  const raw = env.VUS;
  if (raw === undefined) return DEFAULT_VUS;
  const vus = Number(raw);
  if (!POSITIVE_INTEGER.test(raw) || vus > MAX_VUS) {
    throw new Error(
      `環境変数VUSは1以上${String(MAX_VUS)}以下の整数で指定してください: ${raw}`,
    );
  }
  return vus;
};

const durationOf = (env: Env): string => {
  const raw = env.DURATION ?? DEFAULT_DURATION;
  if (!DURATION_PATTERN.test(raw)) {
    throw new Error(
      `環境変数DURATIONは15m・90sのように整数と単位(s・m・h)で指定してください: ${raw}`,
    );
  }
  return raw;
};

export function resolveLoadSettings(env: Env): LoadSettings {
  return {
    clientBaseUrl: baseUrlOf(env, 'CLIENT_BASE_URL'),
    apiBaseUrl: baseUrlOf(env, 'API_BASE_URL'),
    productHandles: handlesOf(env, 'PRODUCT_HANDLES'),
    profileHandles: handlesOf(env, 'PROFILE_HANDLES'),
    vus: vusOf(env),
    duration: durationOf(env),
    summaryPath:
      env.SUMMARY_PATH === undefined || env.SUMMARY_PATH === ''
        ? undefined
        : env.SUMMARY_PATH,
  };
}

const cyclic = (handles: readonly string[], index: number): string =>
  handles[index % handles.length] ?? '';

export function visitPlan(
  settings: LoadSettings,
  userIndex: number,
): readonly VisitStep[] {
  const client = settings.clientBaseUrl;
  const product = cyclic(settings.productHandles, userIndex);
  const profile = cyclic(settings.profileHandles, userIndex);
  return [
    { route: 'top', url: `${client}/` },
    { route: 'directory', url: `${client}/p` },
    { route: 'product', url: `${client}/p/${product}` },
    { route: 'profile', url: `${client}/@${profile}` },
    { route: 'help', url: `${client}/help` },
    { route: 'pricing', url: `${client}/pricing` },
    { route: 'public-api', url: `${settings.apiBaseUrl}/v1/openapi.json` },
  ];
}

export const waitSeconds = (random: number): number =>
  MIN_WAIT_SECONDS + random * (MAX_WAIT_SECONDS - MIN_WAIT_SECONDS);

export function classifyStatus(status: number): StatusClass {
  if (status === HTTP_OK) return 'ok';
  if (status === HTTP_TOO_MANY_REQUESTS) return 'rate_limited';
  return status === 0 || status >= HTTP_SERVER_ERROR_MIN
    ? 'server_error'
    : 'unexpected';
}

export const buildOptions = (settings: LoadSettings): LoadOptions => ({
  scenarios: {
    browse: {
      executor: 'constant-vus',
      vus: settings.vus,
      duration: settings.duration,
    },
  },
  thresholds: LOAD_THRESHOLDS,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'count'],
});

const roundToTenth = (value: number): number => Math.round(value * 10) / 10;

const verdictOf = ({ samples, p95Ms }: LatencyRow): string => {
  if (samples === 0 || Number.isNaN(p95Ms)) return '標本不足';
  return p95Ms < P95_THRESHOLD_MS ? '合格' : '不合格';
};

export const formatLatencyTable = (rows: readonly LatencyRow[]): string =>
  [
    '| 操作 | 標本数 | 95パーセンタイル(ms) | 判定 |',
    '| --- | ---: | ---: | --- |',
    ...rows.map(
      (row) =>
        `| ${row.operation} | ${String(row.samples)} | ${
          Number.isNaN(row.p95Ms) ? '-' : String(roundToTenth(row.p95Ms))
        } | ${verdictOf(row)} |`,
    ),
  ].join('\n');
