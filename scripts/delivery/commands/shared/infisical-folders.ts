import { messageOf } from '../../catalog/error-message.ts';
import type { DeployEnvironment } from '../../catalog/resource-catalog.ts';
import {
  type SecretEntry,
  type SecretFolder,
  type SecretScope,
  maskableValues,
} from '../../core/secret-scope.ts';
import { type DeliveryDeps, EXIT_FAILURE } from './delivery-command.ts';
import {
  type InfisicalTarget,
  loadInfisicalTarget,
} from './infisical-target.ts';
import { reportInputErrors } from './report-violations.ts';

export const INFISICAL_TOKEN_ENV = 'INFISICAL_TOKEN';

export interface InfisicalFolders {
  readonly target: InfisicalTarget;
  readonly folders: readonly (readonly SecretEntry[])[];
}

export function requireInfisicalToken(
  name: string,
  scope: SecretScope,
  deps: Pick<DeliveryDeps, 'env' | 'stderr'>,
): boolean {
  if ((deps.env[INFISICAL_TOKEN_ENV] ?? '') !== '') return true;
  deps.stderr.write(
    `${name}: ${INFISICAL_TOKEN_ENV}がありません。先に\`infisical-login --scope ${scope}\`を実行してください。\n`,
  );
  return false;
}

// 取り出しの失敗は、値を含み得る出力を出さずに環境とフォルダの名前だけを示す
export async function exportInfisicalFolders(
  name: string,
  { projectId, environment, host }: InfisicalTarget,
  folders: readonly SecretFolder[],
  deps: Pick<DeliveryDeps, 'secrets' | 'stderr'>,
): Promise<readonly (readonly SecretEntry[])[] | undefined> {
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
}

// 子プロセスへ渡す前に、取り出したすべての値をマスクする
export async function openInfisicalFolders(
  name: string,
  title: string,
  env: DeployEnvironment,
  folders: readonly SecretFolder[],
  deps: DeliveryDeps,
): Promise<InfisicalFolders | number> {
  if (!requireInfisicalToken(name, env, deps)) return EXIT_FAILURE;
  const target = await loadInfisicalTarget(deps.files, env);
  if (!target.ok) return reportInputErrors(title, target.errors, deps);
  const exported = await exportInfisicalFolders(
    name,
    target.value,
    folders,
    deps,
  );
  if (exported === undefined) return EXIT_FAILURE;
  for (const value of maskableValues(exported.flat())) deps.github.mask(value);
  return { target: target.value, folders: exported };
}
