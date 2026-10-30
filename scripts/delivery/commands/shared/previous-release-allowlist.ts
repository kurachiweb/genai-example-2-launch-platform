import { resolve } from 'node:path';

import type { DeployEnvironment } from '../../catalog/resource-catalog.ts';
import {
  fullyDeployedVersionOf,
  previousReleaseFromVersions,
} from '../../core/previous-release.ts';
import {
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './delivery-command.ts';
import {
  BUN,
  runInTarget,
  stepLineOf,
  type TargetStep,
} from './install-targets.ts';

export interface AllowlistTarget {
  readonly env: DeployEnvironment;
  readonly apiDir: string;
  readonly clientWorker: { readonly name: string; readonly appDir: string };
  readonly cloudflareEnv: Readonly<Record<string, string>>;
}

type Resolution =
  | {
      readonly kind: 'found';
      readonly commit: string;
      readonly versionId: string;
    }
  | { readonly kind: 'unknown'; readonly reason: string };

type WranglerRead =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: string };

const TITLE = '許可リストの生成';

const withNewline = (text: string): string =>
  text === '' || text.endsWith('\n') ? text : `${text}\n`;

// clientのWorkerの版を読むだけなので、ビルドの有無に左右されないよう--nameでWorkerを指定する
const readWrangler = async (
  args: readonly string[],
  { clientWorker, cloudflareEnv }: AllowlistTarget,
  deps: DeliveryDeps,
): Promise<WranglerRead> => {
  const fullArgs = [
    'x',
    'wrangler',
    ...args,
    '--name',
    clientWorker.name,
    '--json',
  ];
  const line = [BUN, ...fullArgs].join(' ');
  deps.stdout.write(`$ (${clientWorker.appDir}) ${line}\n`);
  const result = await deps.runner.run({
    command: BUN,
    args: fullArgs,
    cwd: resolve(deps.repoRoot, clientWorker.appDir),
    env: cloudflareEnv,
    output: 'capture',
  });
  if (result.code === 0) return { ok: true, stdout: result.stdout };
  deps.stderr.write(withNewline(result.stderr));
  return {
    ok: false,
    reason: `${line} が終了コード${String(result.code)}で失敗しました。`,
  };
};

const commitExists = async (
  commit: string,
  deps: DeliveryDeps,
): Promise<boolean> => {
  const { code } = await deps.runner.run({
    command: 'git',
    args: ['cat-file', '-e', `${commit}^{commit}`],
    cwd: deps.repoRoot,
    output: 'capture',
  });
  return code === 0;
};

const resolvePreviousRelease = async (
  target: AllowlistTarget,
  deps: DeliveryDeps,
): Promise<Resolution> => {
  const status = await readWrangler(['deployments', 'status'], target, deps);
  if (!status.ok) return { kind: 'unknown', reason: status.reason };
  const deployed = fullyDeployedVersionOf(status.stdout);
  if (deployed.kind === 'unknown') return deployed;
  const { versionId } = deployed;
  const view = await readWrangler(
    ['versions', 'view', versionId],
    target,
    deps,
  );
  if (!view.ok) return { kind: 'unknown', reason: view.reason };
  const release = previousReleaseFromVersions(status.stdout, (id) =>
    id === versionId ? view.stdout : undefined,
  );
  if (release.kind === 'unknown') return release;
  if (!(await commitExists(release.commit, deps))) {
    return {
      kind: 'unknown',
      reason: `直前のリリースのコミット${release.commit}がリポジトリの履歴にありません。履歴付きでチェックアウトしてください。`,
    };
  }
  return { kind: 'found', commit: release.commit, versionId };
};

const reportResolution = (
  name: string,
  { env, clientWorker }: AllowlistTarget,
  resolution: Resolution,
  deps: DeliveryDeps,
): void => {
  if (resolution.kind === 'found') {
    deps.stdout.write(
      `${name}: 直前のリリースは、clientのWorker(${clientWorker.name})の版${resolution.versionId}のコミット${resolution.commit}です。\n`,
    );
    return;
  }
  const warning = `警告: 直前のリリースを特定できないため、現行の操作だけで許可リストを生成します。${resolution.reason}`;
  deps.stderr.write(`${name}: ${warning}\n`);
  deps.github.summary([`### ${TITLE}(${env})`, '', warning, ''].join('\n'));
};

// APIサーバーのデプロイの間も直前のリリースの画面が送る操作を受け付けるよう、直前のリリースの操作を含めて許可リストを生成する
export async function generateAllowlist(
  name: string,
  target: AllowlistTarget,
  deps: DeliveryDeps,
): Promise<number> {
  const resolution = await resolvePreviousRelease(target, deps);
  reportResolution(name, target, resolution, deps);
  const step: TargetStep = {
    args: [
      'run',
      'graphql:allowlist',
      ...(resolution.kind === 'found'
        ? ['--previous-ref', resolution.commit]
        : []),
    ],
  };
  const code = await runInTarget(target.apiDir, step, deps);
  if (code === 0) return EXIT_SUCCESS;
  deps.stderr.write(
    `${name}: (${target.apiDir}) ${stepLineOf(step)} が終了コード${String(code)}で失敗しました。\n`,
  );
  return EXIT_FAILURE;
}
