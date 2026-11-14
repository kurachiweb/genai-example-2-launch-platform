import type { GithubActionsIo } from '../adapters/github-actions.ts';
import type { SecretSource } from '../adapters/infisical.ts';
import type { SecretEntry } from '../core/secret-scope.ts';
import { PROJECT_ID, validCatalogJson } from './resource-catalog.ts';

export const STAGING_IDENTITY_ID = '5a5a5a5a-1111-4222-8333-444444444444';
export const PROD_IDENTITY_ID = '7b7b7b7b-1111-4222-8333-444444444444';
export const CHECKS_IDENTITY_ID = '9c9c9c9c-1111-4222-8333-444444444444';
export const CATALOG_HOST = 'https://secrets.launch.example';
export const CATALOG_AUDIENCE = 'https://ci.launch.example';

export const infisicalYamlOf = (projectId: string = PROJECT_ID): string =>
  `version: 1\nsecrets-management:\n  project-id: ${projectId}\n`;

const catalogWithIdentity = (
  environment: 'staging' | 'prod',
  identityId: string,
): string => {
  const base = validCatalogJson();
  const renamed =
    environment === 'staging'
      ? base
      : (JSON.parse(
          JSON.stringify(base).replaceAll('staging', 'prod'),
        ) as Record<string, unknown>);
  return JSON.stringify({
    ...renamed,
    infisical: {
      host: CATALOG_HOST,
      projectId: PROJECT_ID,
      identityId,
      oidcAudience: CATALOG_AUDIENCE,
    },
    github:
      environment === 'staging'
        ? { environment: 'staging', branch: 'main' }
        : { environment: 'prod', branch: 'prod' },
  });
};

export const infisicalRepoTexts = (
  identities: { readonly staging?: string; readonly prod?: string } = {},
): Record<string, string> => ({
  '.infisical.yaml': infisicalYamlOf(),
  'apps/infra/environments/staging.json': catalogWithIdentity(
    'staging',
    identities.staging ?? STAGING_IDENTITY_ID,
  ),
  'apps/infra/environments/prod.json': catalogWithIdentity(
    'prod',
    identities.prod ?? PROD_IDENTITY_ID,
  ),
});

export const FAKE_OIDC_TOKEN = 'fake-oidc-jwt';

// 呼び出しの順序を部品をまたいで確かめるため、各部品の出来事を1本の時系列に記録する
export const createRecordingGithub = (timeline: string[]): GithubActionsIo => ({
  mask: (value) => {
    timeline.push(`mask:${value}`);
  },
  exportEnv: (key, value) => {
    timeline.push(`exportEnv:${key}=${value}`);
  },
  summary: (markdown) => {
    timeline.push(`summary:${markdown}`);
  },
  oidcToken: (audience) => {
    timeline.push(`oidc:${audience}`);
    return Promise.resolve(FAKE_OIDC_TOKEN);
  },
});

export interface FakeSecretSourceOptions {
  readonly timeline: string[];
  readonly token?: string;
  readonly folders?: Readonly<Record<string, readonly SecretEntry[]>>;
}

export const folderKeyOf = (environment: string, folder: string): string =>
  `${environment}:${folder}`;

export const createFakeSecretSource = ({
  timeline,
  token = 'fake-access-token',
  folders = {},
}: FakeSecretSourceOptions): SecretSource => ({
  login: ({ identityId, jwt, host }) => {
    timeline.push(`login:${identityId}:${jwt}:${host}`);
    return Promise.resolve(token);
  },
  exportFolder: ({ projectId, environment, folder, host }) => {
    timeline.push(`export:${projectId}:${environment}:${folder}:${host}`);
    const entries = folders[folderKeyOf(environment, folder)];
    return entries === undefined
      ? Promise.reject(
          new Error(
            `Infisicalの${environment}のフォルダ${folder}を取り出せませんでした(終了コード1)`,
          ),
        )
      : Promise.resolve(entries);
  },
});
