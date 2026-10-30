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
