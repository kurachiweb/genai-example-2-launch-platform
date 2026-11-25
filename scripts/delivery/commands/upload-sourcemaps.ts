import { messageOf } from '../catalog/error-message.ts';
import {
  DEPLOY_ENVIRONMENTS,
  type DeployEnvironment,
  WORKER_KEYS,
  type WorkerKey,
} from '../catalog/resource-catalog.ts';
import type { SecretEntry } from '../core/secret-scope.ts';
import {
  SOURCEMAP_BUILD_OUT_DIRS,
  type SentryValues,
  type SourcemapStep,
  planSourcemapUpload,
  readSentryValues,
  sentryCliEnv,
  sourcemapSteps,
} from '../core/sourcemap-upload.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './shared/delivery-command.ts';
import { requireInfisicalToken } from './shared/infisical-folders.ts';
import { loadInfisicalTarget } from './shared/infisical-target.ts';
import { parseOptions, requiredChoice } from './shared/parse-options.ts';
import { reportInputErrors } from './shared/report-violations.ts';

const NAME = 'upload-sourcemaps';
const TITLE = 'ソースマップのアップロード';
const SENTRY_SECRET_FOLDER = '/ci/sentry';

const withNewline = (text: string): string =>
  text === '' || text.endsWith('\n') ? text : `${text}\n`;

const warn = (message: string, deps: DeliveryDeps): void => {
  deps.stderr.write(`${NAME}: 警告: ${message}\n`);
};

// 取り出せない・値が欠ける環境ではアップロードを飛ばしてデプロイを続けるため、失敗ではなく警告の文を返す
const loadSentryValues = async (
  env: DeployEnvironment,
  deps: DeliveryDeps,
): Promise<SentryValues | string | number> => {
  if (!requireInfisicalToken(NAME, env, deps)) return EXIT_FAILURE;
  const target = await loadInfisicalTarget(deps.files, env);
  if (!target.ok) return reportInputErrors(TITLE, target.errors, deps);
  let entries: readonly SecretEntry[];
  try {
    entries = await deps.secrets.exportFolder({
      projectId: target.value.projectId,
      environment: target.value.environment,
      folder: SENTRY_SECRET_FOLDER,
      host: target.value.host,
    });
  } catch (error) {
    return `Infisicalの${env}のフォルダ${SENTRY_SECRET_FOLDER}を取り出せないため、ソースマップのアップロードを飛ばします(${messageOf(error)})`;
  }
  const result = readSentryValues(entries);
  return result.ok
    ? result.values
    : `Infisicalの${env}のフォルダ${SENTRY_SECRET_FOLDER}にキーがないため、ソースマップのアップロードを飛ばします: ${result.missing.join('・')}`;
};

const runStep = async (
  step: SourcemapStep,
  env: Readonly<Record<string, string>> | undefined,
  deps: DeliveryDeps,
): Promise<{ readonly ok: boolean; readonly stderr: string }> => {
  const line = [step.command, ...step.args].join(' ');
  deps.stdout.write(`$ ${line}\n`);
  const result = await deps.runner.run({
    command: step.command,
    args: step.args,
    cwd: deps.repoRoot,
    ...(env === undefined ? {} : { env }),
    output: 'capture',
  });
  deps.stdout.write(withNewline(result.stdout));
  deps.stderr.write(withNewline(result.stderr));
  return { ok: result.code === 0, stderr: result.stderr };
};

const reportStepFailure = (
  step: SourcemapStep,
  app: WorkerKey,
  deps: DeliveryDeps,
): void => {
  const message = `${app}のソースマップの手順(${step.kind})が失敗しました。デプロイは続けますが、エラートラッキングで元のソースの位置を表示できません。`;
  warn(message, deps);
  deps.github.summary(
    [`### ${TITLE}(${app})`, '', `- 警告: ${message}`, ''].join('\n'),
  );
};

// デバッグIDの埋め込みとアップロードの失敗はデプロイを止めない。ソースが静的な配信物に残るのを防ぐ.mapの削除は、失敗したら止める
export async function uploadSourcemaps(
  env: DeployEnvironment,
  app: WorkerKey,
  deps: DeliveryDeps,
): Promise<number> {
  const sentry = await loadSentryValues(env, deps);
  if (typeof sentry === 'number') return sentry;
  const [inject, upload, remove] = sourcemapSteps(
    planSourcemapUpload(app, SOURCEMAP_BUILD_OUT_DIRS[app]),
  );
  if (typeof sentry === 'string') {
    warn(sentry, deps);
  } else {
    // マスクを値の使用より先に行い、子プロセスの出力にトークンが混ざっても伏せる
    deps.github.mask(sentry.authToken);
    const sentryEnv = sentryCliEnv(sentry);
    for (const step of [inject, upload]) {
      if (step === undefined) continue;
      const done = await runStep(step, sentryEnv, deps);
      if (done.ok) continue;
      reportStepFailure(step, app, deps);
      break;
    }
  }
  if (remove === undefined) return EXIT_SUCCESS;
  const removed = await runStep(remove, undefined, deps);
  if (removed.ok) return EXIT_SUCCESS;
  deps.stderr.write(
    `${NAME}: ${app}の配信物から.mapを削除できませんでした。\n`,
  );
  return EXIT_FAILURE;
}

export const command: DeliveryCommand = {
  name: NAME,
  description:
    '/ci/sentryの値(トークンは先にマスク)で、アプリのビルドの出力へデバッグIDを埋め込んでソースマップをアップロードし、client・adminの静的な配信物から.mapを削除する(値が無い環境と、埋め込み・アップロードの失敗は警告だけで続ける)',
  run: async (args, deps) => {
    const { options } = parseOptions(args, {
      names: ['env', 'app'],
      rest: 'none',
    });
    const env = requiredChoice(options, 'env', DEPLOY_ENVIRONMENTS);
    const app = requiredChoice(options, 'app', WORKER_KEYS);
    return uploadSourcemaps(env, app, deps);
  },
};
