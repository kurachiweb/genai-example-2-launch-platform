import { resolve } from 'node:path';

import {
  DEPLOY_ENVIRONMENTS,
  resourceCatalogPath,
} from '../catalog/resource-catalog.ts';
import { openCloudflareSecrets } from './shared/cloudflare-secrets.ts';
import {
  type DeliveryCommand,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './shared/delivery-command.ts';
import { BUN } from './shared/install-targets.ts';
import { loadResourceCatalog } from './shared/load-catalog.ts';
import { parseOptions, requiredChoice } from './shared/parse-options.ts';
import { reportInputErrors } from './shared/report-violations.ts';

const NAME = 'migrate';
const TITLE = 'リモートのマイグレーション';
const MAIN_D1 = 'main';

export const command: DeliveryCommand = {
  name: NAME,
  description:
    '/ci/cloudflareのトークンで、apiから資源一覧のD1(d1.main)へリモートのマイグレーションを適用する',
  run: async (args, deps) => {
    const { options } = parseOptions(args, { names: ['env'], rest: 'none' });
    const env = requiredChoice(options, 'env', DEPLOY_ENVIRONMENTS);
    const catalog = await loadResourceCatalog(deps.files, env);
    if (!catalog.ok) return reportInputErrors(TITLE, catalog.errors, deps);
    const database = catalog.value.d1[MAIN_D1];
    if (database === undefined) {
      return reportInputErrors(
        TITLE,
        [`${resourceCatalogPath(env)}: d1.${MAIN_D1}がありません`],
        deps,
      );
    }
    const secrets = await openCloudflareSecrets(NAME, env, [], deps);
    if (typeof secrets === 'number') return secrets;
    const { appDir } = catalog.value.workers.api;
    const migrationArgs = [
      'x',
      'wrangler',
      'd1',
      'migrations',
      'apply',
      database.name,
      '--env',
      env,
      '--remote',
    ];
    const line = [BUN, ...migrationArgs].join(' ');
    deps.stdout.write(`$ (${appDir}) ${line}\n`);
    const { code } = await deps.runner.run({
      command: BUN,
      args: migrationArgs,
      cwd: resolve(deps.repoRoot, appDir),
      env: secrets.cloudflareEnv,
      output: 'inherit',
    });
    if (code !== 0) {
      deps.stderr.write(
        `${NAME}: ${line} が終了コード${String(code)}で失敗しました。\n`,
      );
      return EXIT_FAILURE;
    }
    deps.github.summary(`${TITLE}(${env})を${database.name}へ適用しました。\n`);
    return EXIT_SUCCESS;
  },
};
