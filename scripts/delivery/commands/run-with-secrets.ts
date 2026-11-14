import { WORKER_KEYS } from '../catalog/resource-catalog.ts';
import {
  RUN_SECRETS_SCOPES,
  type SecretFolder,
  SHARED_SECRET_FOLDER,
  WORKER_SCOPED_SECRETS,
  WORKER_SECRET_FOLDERS,
  layerWorkerSecrets,
  maskableValues,
} from '../core/secret-scope.ts';
import {
  type DeliveryCommand,
  EXIT_FAILURE,
  UsageError,
} from './shared/delivery-command.ts';
import {
  exportInfisicalFolders,
  requireInfisicalToken,
} from './shared/infisical-folders.ts';
import { loadInfisicalTarget } from './shared/infisical-target.ts';
import {
  optionalChoice,
  parseOptions,
  requiredChoice,
} from './shared/parse-options.ts';
import { reportInputErrors } from './shared/report-violations.ts';

const NAME = 'run-with-secrets';
const TITLE = 'シークレットの注入';

const WORKERS_WITH_FOLDER = WORKER_KEYS.filter(
  (worker) => WORKER_SECRET_FOLDERS[worker] !== undefined,
);

export const command: DeliveryCommand = {
  name: NAME,
  description:
    'devの共通のフォルダ(Workerの指定があればそのWorkerのフォルダを重ねる)の値をマスクしてから環境変数にしてコマンドを起動する',
  run: async (args, deps) => {
    const { options, rest } = parseOptions(args, {
      names: ['scope', 'worker'],
      rest: 'allowed',
    });
    const scope = requiredChoice(options, 'scope', RUN_SECRETS_SCOPES);
    const worker = optionalChoice(options, 'worker', WORKERS_WITH_FOLDER);
    const [executable, ...executableArgs] = rest;
    if (executable === undefined) {
      throw new UsageError('`--`の後に起動するコマンドを指定してください');
    }
    // 検査では直前のログインの主体で取り出し、ローカルでは開発者自身のログインで取り出す
    if (scope === 'checks' && !requireInfisicalToken(NAME, scope, deps)) {
      return EXIT_FAILURE;
    }
    const target = await loadInfisicalTarget(deps.files, 'checks');
    if (!target.ok) return reportInputErrors(TITLE, target.errors, deps);
    const workerFolder =
      worker === undefined ? undefined : WORKER_SECRET_FOLDERS[worker];
    const folders: readonly SecretFolder[] =
      workerFolder === undefined
        ? [SHARED_SECRET_FOLDER]
        : [SHARED_SECRET_FOLDER, workerFolder];
    const exported = await exportInfisicalFolders(
      NAME,
      target.value,
      folders,
      deps,
    );
    if (exported === undefined) return EXIT_FAILURE;
    const [shared = [], perWorker = []] = exported;
    const entries = layerWorkerSecrets({
      shared,
      perWorker,
      workerScoped: WORKER_SCOPED_SECRETS,
    });
    for (const value of maskableValues(entries)) deps.github.mask(value);
    deps.stdout.write(
      `${NAME}: ${target.value.environment}の${folders.join('と')}から${String(entries.length)}件のシークレットを注入して起動します: ${rest.join(' ')}\n`,
    );
    const result = await deps.runner.run({
      command: executable,
      args: executableArgs,
      env: Object.fromEntries(entries.map(({ key, value }) => [key, value])),
      output: 'inherit',
    });
    return result.code;
  },
};
