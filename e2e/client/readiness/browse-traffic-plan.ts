export const TRAFFIC_SECONDS_ENV_KEY = 'READINESS_TRAFFIC_SECONDS';

export const TRAFFIC_MANIFEST_ENV_KEY = 'READINESS_TRAFFIC_MANIFEST';

export const DEFAULT_MANIFEST_PATH =
  '/workspace/tmp/readiness/synthetic/manifest.json';

const MILLISECONDS_PER_SECOND = 1_000;

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;

const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

export type BrowseTraffic =
  | { readonly kind: 'skip'; readonly reason: string }
  | {
      readonly kind: 'run';
      readonly durationMs: number;
      readonly manifestPath: string;
    };

export interface TrafficSamples {
  readonly productHandles: readonly string[];
  readonly profileHandles: readonly string[];
  readonly helpArticleHandle: string;
}

type Env = Readonly<Record<string, string | undefined>>;

// 未設定の実行(通常のローカルの実行・デプロイ後のスモーク)が静かに閲覧を省いたことを、対象外の理由として残す
export function resolveBrowseTraffic(env: Env): BrowseTraffic {
  const seconds = env[TRAFFIC_SECONDS_ENV_KEY];
  if (seconds === undefined || seconds === '') {
    return {
      kind: 'skip',
      reason: `${TRAFFIC_SECONDS_ENV_KEY}が未設定のため閲覧を繰り返さない`,
    };
  }
  if (!POSITIVE_INTEGER_PATTERN.test(seconds)) {
    throw new Error(
      `${TRAFFIC_SECONDS_ENV_KEY}は繰り返す秒数を正の整数で指定してください: ${seconds}`,
    );
  }
  return {
    kind: 'run',
    durationMs: Number(seconds) * MILLISECONDS_PER_SECOND,
    manifestPath: env[TRAFFIC_MANIFEST_ENV_KEY] || DEFAULT_MANIFEST_PATH,
  };
}

const handlesOf = (samples: unknown, name: string): readonly string[] => {
  const value: unknown =
    typeof samples === 'object' && samples !== null
      ? Reflect.get(samples, name)
      : undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (handle): handle is string =>
        typeof handle === 'string' && HANDLE_PATTERN.test(handle),
    )
  ) {
    throw new Error(
      `合成データの一覧の見本の${name}に、ハンドルを1つ以上指定してください`,
    );
  }
  return value;
};

const MANIFEST_SAMPLES_KEY = 'samples';

export function parseTrafficSamples(manifest: unknown): TrafficSamples {
  const samples: unknown =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, MANIFEST_SAMPLES_KEY)
      : undefined;
  const [helpArticleHandle] = handlesOf(samples, 'largeHelpArticleHandle');
  return {
    productHandles: handlesOf(samples, 'productHandles'),
    profileHandles: handlesOf(samples, 'profileHandles'),
    helpArticleHandle: helpArticleHandle ?? '',
  };
}

const cyclic = (handles: readonly string[], round: number): string =>
  handles[round % handles.length] ?? '';

// 主要6ページ(トップ・ディレクトリ・プロダクト詳細・プロフィール・ヘルプ・料金)の後に、本文が上限のヘルプ記事の詳細を開く。順は負荷試験の台本の巡回と揃える
export function browsePathsOf(
  samples: TrafficSamples,
  round: number,
): readonly string[] {
  return [
    '/',
    '/p',
    `/p/${cyclic(samples.productHandles, round)}`,
    `/@${cyclic(samples.profileHandles, round)}`,
    '/help',
    '/pricing',
    `/help/${samples.helpArticleHandle}`,
  ];
}
