import { isUuid } from './resource-catalog.ts';

export const INFISICAL_CONFIG_PATH = '.infisical.yaml';

const PROJECT_ID_PATH = 'secrets-management.project-id';

export interface CheckSecretsSettings {
  readonly environment: 'dev';
  readonly host: string;
  readonly projectId: string;
  readonly identityId: string;
  readonly oidcAudience: string;
}

export const CHECK_SECRETS_IDENTITY: Omit<CheckSecretsSettings, 'projectId'> = {
  environment: 'dev',
  host: 'https://eu.infisical.com',
  identityId: '408ab354-b8c7-4bd1-b418-f276cd44ced2',
  oidcAudience: 'https://github.com/kurachiweb',
};

export type CheckSecretsResult =
  | { readonly ok: true; readonly settings: CheckSecretsSettings }
  | { readonly ok: false; readonly errors: readonly string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const parseYaml = (
  text: string,
): { readonly value: unknown } | { readonly error: string } => {
  try {
    return { value: Bun.YAML.parse(text) };
  } catch (error) {
    return {
      error: `${INFISICAL_CONFIG_PATH}: YAMLとして解析できません(${messageOf(error)})`,
    };
  }
};

const projectIdOf = (config: unknown): unknown => {
  if (!isRecord(config)) return undefined;
  const management = config['secrets-management'];
  return isRecord(management) ? management['project-id'] : undefined;
};

export function checkSecretsSettings(
  infisicalYaml: string,
): CheckSecretsResult {
  const parsed = parseYaml(infisicalYaml);
  if ('error' in parsed) return { ok: false, errors: [parsed.error] };
  const projectId = projectIdOf(parsed.value);
  if (typeof projectId !== 'string' || !isUuid(projectId)) {
    const actual =
      projectId === undefined ? '(なし)' : JSON.stringify(projectId);
    return {
      ok: false,
      errors: [
        `${PROJECT_ID_PATH}: 英小文字の16進のUUIDが必要です(実際: ${actual})`,
      ],
    };
  }
  return { ok: true, settings: { ...CHECK_SECRETS_IDENTITY, projectId } };
}
