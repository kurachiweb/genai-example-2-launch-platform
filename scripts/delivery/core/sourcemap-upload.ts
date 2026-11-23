import type { WorkerKey } from '../catalog/resource-catalog.ts';
import type { SecretEntry } from './secret-scope.ts';

export interface SourcemapUploadPlan {
  readonly app: WorkerKey;
  readonly artifactDir: string;
  readonly removeMapsFrom: string | null;
}

export interface SentryValues {
  readonly authToken: string;
  readonly org: string;
  readonly project: string;
}

export type SentryValuesResult =
  | { readonly ok: true; readonly values: SentryValues }
  | { readonly ok: false; readonly missing: readonly string[] };

export type SourcemapStepKind = 'inject' | 'upload' | 'remove-maps';

export interface SourcemapStep {
  readonly kind: SourcemapStepKind;
  readonly command: string;
  readonly args: readonly string[];
}

const AUTH_TOKEN_KEY = 'SENTRY_AUTH_TOKEN';
const ORG_KEY = 'SENTRY_ORG';
const PROJECT_KEY = 'SENTRY_PROJECT';

const VITE_STATIC_DIR = 'client';
const VITE_STATIC_APPS: ReadonlySet<WorkerKey> = new Set(['client', 'admin']);

export const SOURCEMAP_BUILD_OUT_DIRS: Readonly<Record<WorkerKey, string>> = {
  client: 'apps/client/dist',
  admin: 'apps/admin/dist',
  api: 'apps/api/.wrangler/sourcemaps',
  event: 'apps/event/.wrangler/sourcemaps',
};

const SENTRY_CLI_ARGS: readonly string[] = ['x', '--no-install', 'sentry-cli'];

export function sentryFolderKeys(): readonly [
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
] {
  return [AUTH_TOKEN_KEY, ORG_KEY, PROJECT_KEY];
}

const withoutTrailingSlashes = (path: string): string =>
  path.replace(/\/+$/, '');

// 出力先が空だと、削除と埋め込みの対象が呼び出し元の作業ディレクトリ全体になるため受け付けない
export function planSourcemapUpload(
  app: WorkerKey,
  buildOutDir: string,
): SourcemapUploadPlan {
  const artifactDir = withoutTrailingSlashes(buildOutDir.trim());
  if (artifactDir === '') {
    throw new Error(`${app}のビルドの出力先が空です`);
  }
  return {
    app,
    artifactDir,
    removeMapsFrom: VITE_STATIC_APPS.has(app)
      ? `${artifactDir}/${VITE_STATIC_DIR}`
      : null,
  };
}

export function readSentryValues(
  entries: readonly SecretEntry[],
): SentryValuesResult {
  const valueOf = (key: string): string =>
    entries.find((entry) => entry.key === key)?.value.trim() ?? '';
  const authToken = valueOf(AUTH_TOKEN_KEY);
  const org = valueOf(ORG_KEY);
  const project = valueOf(PROJECT_KEY);
  const missing = sentryFolderKeys().filter((key) => valueOf(key) === '');
  return missing.length > 0
    ? { ok: false, missing }
    : { ok: true, values: { authToken, org, project } };
}

// トークンをコマンドの引数に置くとプロセスの一覧から読めてしまうため、sentry-cliが読む環境変数で渡す
export function sentryCliEnv({
  authToken,
  org,
  project,
}: SentryValues): Readonly<Record<string, string>> {
  return {
    [AUTH_TOKEN_KEY]: authToken,
    [ORG_KEY]: org,
    [PROJECT_KEY]: project,
  };
}

const sentryCliStep = (
  kind: 'inject' | 'upload',
  artifactDir: string,
): SourcemapStep => ({
  kind,
  command: 'bun',
  args: [...SENTRY_CLI_ARGS, 'sourcemaps', kind, artifactDir],
});

export function sourcemapSteps({
  artifactDir,
  removeMapsFrom,
}: SourcemapUploadPlan): readonly SourcemapStep[] {
  return [
    sentryCliStep('inject', artifactDir),
    sentryCliStep('upload', artifactDir),
    ...(removeMapsFrom === null
      ? []
      : [
          {
            kind: 'remove-maps' as const,
            command: 'find',
            args: [removeMapsFrom, '-type', 'f', '-name', '*.map', '-delete'],
          },
        ]),
  ];
}
