import type { RepoFiles } from '../../adapters/repo-files.ts';
import {
  CHECK_SECRETS_IDENTITY,
  type CheckSecretsSettings,
  INFISICAL_CONFIG_PATH,
  checkSecretsSettings,
} from '../../catalog/check-secrets.ts';
import { resourceCatalogPath } from '../../catalog/resource-catalog.ts';
import {
  ENVIRONMENT_OF_SCOPE,
  type InfisicalEnvironment,
  type SecretScope,
} from '../../core/secret-scope.ts';
import { loadResourceCatalog } from './load-catalog.ts';
import { type Loaded, failed, loaded, readInput } from './load-input.ts';

export interface InfisicalTarget {
  readonly scope: SecretScope;
  readonly environment: InfisicalEnvironment;
  readonly projectId: string;
  readonly host: string;
  readonly identityId: string;
  readonly oidcAudience: string;
  readonly identitySource: string;
}

export type ChecksIdentity = Omit<CheckSecretsSettings, 'projectId'>;

export const CHECK_SECRETS_IDENTITY_SOURCE =
  'scripts/delivery/catalog/check-secrets.ts';

const loadChecksTarget = async (
  files: RepoFiles,
  identity: ChecksIdentity,
): Promise<Loaded<InfisicalTarget>> => {
  const text = await readInput(files, INFISICAL_CONFIG_PATH);
  if (!text.ok) return text;
  const result = checkSecretsSettings(text.value);
  if (!result.ok) return failed(result.errors);
  return loaded({
    scope: 'checks',
    environment: ENVIRONMENT_OF_SCOPE.checks,
    projectId: result.settings.projectId,
    host: identity.host,
    identityId: identity.identityId,
    oidcAudience: identity.oidcAudience,
    identitySource: CHECK_SECRETS_IDENTITY_SOURCE,
  });
};

// 3つの範囲は同じプロジェクトを使い、取り出す環境と主体だけが異なる
export async function loadInfisicalTarget(
  files: RepoFiles,
  scope: SecretScope,
  checksIdentity: ChecksIdentity = CHECK_SECRETS_IDENTITY,
): Promise<Loaded<InfisicalTarget>> {
  if (scope === 'checks') return loadChecksTarget(files, checksIdentity);
  const catalog = await loadResourceCatalog(files, scope);
  if (!catalog.ok) return catalog;
  const { infisical } = catalog.value;
  return loaded({
    scope,
    environment: ENVIRONMENT_OF_SCOPE[scope],
    projectId: infisical.projectId,
    host: infisical.host,
    identityId: infisical.identityId,
    oidcAudience: infisical.oidcAudience,
    identitySource: resourceCatalogPath(scope),
  });
}
