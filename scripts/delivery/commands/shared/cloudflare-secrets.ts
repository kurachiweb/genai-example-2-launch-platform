import type { DeployEnvironment } from '../../catalog/resource-catalog.ts';
import type { SecretEntry, SecretFolder } from '../../core/secret-scope.ts';
import { type DeliveryDeps, EXIT_FAILURE } from './delivery-command.ts';
import { openInfisicalFolders } from './infisical-folders.ts';
import type { InfisicalTarget } from './infisical-target.ts';

export const CLOUDFLARE_SECRET_FOLDER = '/ci/cloudflare';
export const CLOUDFLARE_TOKEN_KEY = 'CLOUDFLARE_API_TOKEN';
export const CLOUDFLARE_ACCOUNT_ID_KEY = 'CLOUDFLARE_ACCOUNT_ID';

const TITLE = 'Cloudflareのシークレットの取り出し';

export interface CloudflareSecrets {
  readonly target: InfisicalTarget;
  readonly cloudflareEnv: Readonly<Record<string, string>>;
  readonly folders: readonly (readonly SecretEntry[])[];
}

// /ci/cloudflareと指定したフォルダを取り出し、子プロセスへ渡す前にすべての値をマスクする
// トークンが複数のアカウントに届いてもWranglerが操作先を選べるよう、資源一覧のアカウントIDをトークンと並べて渡す
export async function openCloudflareSecrets(
  name: string,
  env: DeployEnvironment,
  accountId: string,
  folders: readonly SecretFolder[],
  deps: DeliveryDeps,
): Promise<CloudflareSecrets | number> {
  const opened = await openInfisicalFolders(
    name,
    TITLE,
    env,
    [CLOUDFLARE_SECRET_FOLDER, ...folders],
    deps,
  );
  if (typeof opened === 'number') return opened;
  const [cloudflare = [], ...rest] = opened.folders;
  const token = cloudflare.find(({ key }) => key === CLOUDFLARE_TOKEN_KEY);
  if (token === undefined) {
    deps.stderr.write(
      `${name}: Infisicalの${opened.target.environment}のフォルダ${CLOUDFLARE_SECRET_FOLDER}にキーがありません: ${CLOUDFLARE_TOKEN_KEY}\n`,
    );
    return EXIT_FAILURE;
  }
  return {
    target: opened.target,
    cloudflareEnv: {
      [CLOUDFLARE_TOKEN_KEY]: token.value,
      [CLOUDFLARE_ACCOUNT_ID_KEY]: accountId,
    },
    folders: rest,
  };
}
