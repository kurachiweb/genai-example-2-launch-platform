import type { DeployEnvironment } from '../../catalog/resource-catalog.ts';
import {
  type SecretEntry,
  type SecretFolder,
  maskableValues,
} from '../../core/secret-scope.ts';
import { type DeliveryDeps, EXIT_FAILURE } from './delivery-command.ts';
import {
  type InfisicalTarget,
  loadInfisicalTarget,
} from './infisical-target.ts';
import { reportInputErrors } from './report-violations.ts';

export const CLOUDFLARE_SECRET_FOLDER = '/ci/cloudflare';
export const CLOUDFLARE_TOKEN_KEY = 'CLOUDFLARE_API_TOKEN';
export const CLOUDFLARE_ACCOUNT_ID_KEY = 'CLOUDFLARE_ACCOUNT_ID';

const TOKEN_ENV = 'INFISICAL_TOKEN';
const TITLE = 'Cloudflareのシークレットの取り出し';

export interface CloudflareSecrets {
  readonly target: InfisicalTarget;
  readonly cloudflareEnv: Readonly<Record<string, string>>;
  readonly folders: readonly (readonly SecretEntry[])[];
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// 取り出しの失敗は、値を含み得る出力を出さずに環境とフォルダの名前だけを示す
const exportFolders = async (
  name: string,
  { projectId, environment, host }: InfisicalTarget,
  folders: readonly SecretFolder[],
  deps: DeliveryDeps,
): Promise<readonly (readonly SecretEntry[])[] | undefined> => {
  const exported: (readonly SecretEntry[])[] = [];
  for (const folder of folders) {
    try {
      exported.push(
        await deps.secrets.exportFolder({
          projectId,
          environment,
          folder,
          host,
        }),
      );
    } catch (error) {
      deps.stderr.write(`${name}: ${messageOf(error)}\n`);
      return undefined;
    }
  }
  return exported;
};

// /ci/cloudflareと指定したフォルダを取り出し、子プロセスへ渡す前にすべての値をマスクする
// トークンが複数のアカウントに届いてもWranglerが操作先を選べるよう、資源一覧のアカウントIDをトークンと並べて渡す
export async function openCloudflareSecrets(
  name: string,
  env: DeployEnvironment,
  accountId: string,
  folders: readonly SecretFolder[],
  deps: DeliveryDeps,
): Promise<CloudflareSecrets | number> {
  if ((deps.env[TOKEN_ENV] ?? '') === '') {
    deps.stderr.write(
      `${name}: ${TOKEN_ENV}がありません。先に\`infisical-login --scope ${env}\`を実行してください。\n`,
    );
    return EXIT_FAILURE;
  }
  const target = await loadInfisicalTarget(deps.files, env);
  if (!target.ok) return reportInputErrors(TITLE, target.errors, deps);
  const exported = await exportFolders(
    name,
    target.value,
    [CLOUDFLARE_SECRET_FOLDER, ...folders],
    deps,
  );
  if (exported === undefined) return EXIT_FAILURE;
  for (const value of maskableValues(exported.flat())) deps.github.mask(value);
  const [cloudflare = [], ...rest] = exported;
  const token = cloudflare.find(({ key }) => key === CLOUDFLARE_TOKEN_KEY);
  if (token === undefined) {
    deps.stderr.write(
      `${name}: Infisicalの${target.value.environment}のフォルダ${CLOUDFLARE_SECRET_FOLDER}にキーがありません: ${CLOUDFLARE_TOKEN_KEY}\n`,
    );
    return EXIT_FAILURE;
  }
  return {
    target: target.value,
    cloudflareEnv: {
      [CLOUDFLARE_TOKEN_KEY]: token.value,
      [CLOUDFLARE_ACCOUNT_ID_KEY]: accountId,
    },
    folders: rest,
  };
}
