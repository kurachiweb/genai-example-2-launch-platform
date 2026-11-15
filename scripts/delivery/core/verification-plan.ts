import type { ResourceCatalog } from '../catalog/resource-catalog.ts';

export type VerificationPlan =
  | {
      readonly kind: 'smoke-e2e';
      readonly clientUrl: string;
      readonly adminUrl: string;
      readonly waitForHealth: string;
    }
  | { readonly kind: 'health'; readonly urls: readonly string[] };

export type SmokeE2ePlan = Extract<VerificationPlan, { kind: 'smoke-e2e' }>;

export type VerificationPlanResult =
  | { readonly ok: true; readonly plan: VerificationPlan }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface SmokeE2eCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export type SmokeCountResult =
  | { readonly ok: true; readonly count: number }
  | { readonly ok: false; readonly error: string };

export interface WaitFailure {
  readonly url: string;
  readonly lastStatus: number | undefined;
}

// 初回のデプロイではカスタムドメインの証明書の発行を待つため長めに取る
export const VERIFY_WAIT_TIMEOUT_MS = 600_000;
export const VERIFY_EXPECT_STATUS = 200;
export const SMOKE_TAG = '@smoke';

const HEALTH_PATH = '/health';
const TOP_PATH = '/';
const MS_PER_MINUTE = 60_000;

type TargetKey = 'api' | 'event' | 'client' | 'admin';

const originOf = (
  catalog: ResourceCatalog,
  key: TargetKey,
): string | undefined => {
  const assignment = catalog.hostnames[key];
  return assignment === undefined
    ? undefined
    : `https://${assignment.hostname}`;
};

const missingOf = (
  catalog: ResourceCatalog,
  keys: readonly TargetKey[],
): VerificationPlanResult => ({
  ok: false,
  errors: keys
    .filter((key) => originOf(catalog, key) === undefined)
    .map((key) => `hostnames.${key}がありません(デプロイ後の確認の対象です)`),
});

const smokePlanOf = (catalog: ResourceCatalog): VerificationPlanResult => {
  const api = originOf(catalog, 'api');
  const client = originOf(catalog, 'client');
  const admin = originOf(catalog, 'admin');
  if (api === undefined || client === undefined || admin === undefined) {
    return missingOf(catalog, ['api', 'client', 'admin']);
  }
  return {
    ok: true,
    plan: {
      kind: 'smoke-e2e',
      clientUrl: client,
      adminUrl: admin,
      waitForHealth: `${api}${HEALTH_PATH}`,
    },
  };
};

const healthPlanOf = (catalog: ResourceCatalog): VerificationPlanResult => {
  const api = originOf(catalog, 'api');
  const event = originOf(catalog, 'event');
  const client = originOf(catalog, 'client');
  if (api === undefined || event === undefined || client === undefined) {
    return missingOf(catalog, ['api', 'event', 'client']);
  }
  return {
    ok: true,
    plan: {
      kind: 'health',
      urls: [
        `${api}${HEALTH_PATH}`,
        `${event}${HEALTH_PATH}`,
        `${client}${TOP_PATH}`,
      ],
    },
  };
};

export function verificationPlanFor(
  catalog: ResourceCatalog,
): VerificationPlanResult {
  return catalog.environment === 'staging'
    ? smokePlanOf(catalog)
    : healthPlanOf(catalog);
}

export const smokeE2eCommandOf = ({
  clientUrl,
  adminUrl,
}: SmokeE2ePlan): SmokeE2eCommand => ({
  command: 'bun',
  args: ['run', 'test:e2e', '--grep', SMOKE_TAG],
  env: { E2E_CLIENT_URL: clientUrl, E2E_ADMIN_URL: adminUrl },
});

export const smokeListCommandOf = (plan: SmokeE2ePlan): SmokeE2eCommand => {
  const run = smokeE2eCommandOf(plan);
  return { ...run, args: [...run.args, '--list', '--reporter=json'] };
};

// PlaywrightのJSONの報告はタグを先頭の`@`を除いて持つ
const SMOKE_TAG_IN_REPORT = SMOKE_TAG.slice(1);

class ListShapeError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const arrayAt = (
  record: Record<string, unknown>,
  key: string,
): readonly unknown[] => {
  const value = record[key] ?? [];
  if (!Array.isArray(value)) {
    throw new ListShapeError(`${key}が配列ではありません`);
  }
  return value;
};

const smokeTestsOfSpec = (spec: unknown): number => {
  if (!isRecord(spec))
    throw new ListShapeError('specがオブジェクトではありません');
  const tests = arrayAt(spec, 'tests');
  return arrayAt(spec, 'tags').includes(SMOKE_TAG_IN_REPORT) ? tests.length : 0;
};

// 到達確認のsetupは`--grep`で絞り落とされずタグも持たないため、タグで数えて除く
const smokeTestsOfSuite = (suite: unknown): number => {
  if (!isRecord(suite)) {
    throw new ListShapeError('suiteがオブジェクトではありません');
  }
  const own = arrayAt(suite, 'specs').reduce<number>(
    (sum, spec) => sum + smokeTestsOfSpec(spec),
    0,
  );
  return arrayAt(suite, 'suites').reduce<number>(
    (sum, child) => sum + smokeTestsOfSuite(child),
    own,
  );
};

const messageOfListError = (error: unknown): string =>
  isRecord(error) && typeof error.message === 'string'
    ? error.message
    : JSON.stringify(error);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ListShapeError('JSONとして読めません');
  }
};

export function countSmokeTests(listJson: string): SmokeCountResult {
  try {
    const report = parseJson(listJson);
    if (!isRecord(report)) {
      throw new ListShapeError('JSONがオブジェクトではありません');
    }
    const errors = arrayAt(report, 'errors');
    if (errors.length > 0) {
      return {
        ok: false,
        error: `テストの一覧の作成で誤りがありました: ${errors.map(messageOfListError).join('、')}`,
      };
    }
    if (!Array.isArray(report.suites)) {
      throw new ListShapeError('suitesが配列ではありません');
    }
    const count = report.suites.reduce<number>(
      (sum, suite) => sum + smokeTestsOfSuite(suite),
      0,
    );
    return { ok: true, count };
  } catch (error) {
    if (!(error instanceof ListShapeError)) throw error;
    return {
      ok: false,
      error: `テストの一覧の件数を数えられません(${error.message})`,
    };
  }
}

const WAIT_MINUTES = String(VERIFY_WAIT_TIMEOUT_MS / MS_PER_MINUTE);

const lastStateOf = (lastStatus: number | undefined): string =>
  lastStatus === undefined
    ? '応答がありませんでした'
    : `最後の状態コード: ${String(lastStatus)}`;

export function waitFailureReport(failures: readonly WaitFailure[]): string {
  return failures
    .map(
      ({ url, lastStatus }) =>
        `- ${url}: ${WAIT_MINUTES}分以内に${String(VERIFY_EXPECT_STATUS)}を返しませんでした(${lastStateOf(lastStatus)})\n`,
    )
    .join('');
}
