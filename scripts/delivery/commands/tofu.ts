import { DEPLOY_ENVIRONMENTS } from '../catalog/resource-catalog.ts';
import { filterApplyOutput } from '../core/apply-output.ts';
import { formatPlanSummary, summarizePlan } from '../core/plan-summary.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './shared/delivery-command.ts';
import { parseOptions, requiredChoice } from './shared/parse-options.ts';
import {
  type TofuSession,
  initTofu,
  openTofuSession,
  runTofuStep,
} from './shared/tofu-session.ts';

const NAME = 'tofu';

export const TOFU_PHASES = ['foundation', 'routing'] as const;
export type TofuPhase = (typeof TOFU_PHASES)[number];

// ホスト名の割り当てはWorkerのデプロイの後に作るため、1段目の計画から除く
const EXCLUDED_IN_FOUNDATION = '-exclude=module.worker_routing';
const LOCK_TIMEOUT = '-lock-timeout=5m';

const planFileOf = (session: TofuSession): string => `${session.env}.tfplan`;

// providerはInfisicalへOIDCで入り直すため、トークンの期限切れを避けて計画と適用の直前に毎回新しく取得する
const providerEnvOf = async (
  session: TofuSession,
  deps: DeliveryDeps,
): Promise<Record<string, string>> => {
  const jwt = await deps.github.oidcToken(session.target.oidcAudience);
  deps.github.mask(jwt);
  return {
    ...session.stateEnv,
    INFISICAL_AUTH_METHOD: 'oidc',
    INFISICAL_MACHINE_IDENTITY_ID: session.target.identityId,
    INFISICAL_AUTH_JWT: jwt,
  };
};

const plan = async (
  session: TofuSession,
  phase: TofuPhase,
  deps: DeliveryDeps,
): Promise<boolean> => {
  const env = await providerEnvOf(session, deps);
  const result = await runTofuStep(
    NAME,
    {
      args: [
        'plan',
        '-input=false',
        '-no-color',
        LOCK_TIMEOUT,
        '-var',
        `environment=${session.env}`,
        ...(phase === 'foundation' ? [EXCLUDED_IN_FOUNDATION] : []),
        `-out=${planFileOf(session)}`,
      ],
      env,
      output: 'capture',
    },
    deps,
  );
  return result !== undefined;
};

const reportPlan = async (
  session: TofuSession,
  phase: TofuPhase,
  deps: DeliveryDeps,
): Promise<boolean> => {
  const shown = await runTofuStep(
    NAME,
    {
      args: ['show', '-json', planFileOf(session)],
      env: session.stateEnv,
      output: 'capture',
    },
    deps,
  );
  if (shown === undefined) return false;
  const changes = summarizePlan(shown.stdout);
  if ('error' in changes) {
    deps.stderr.write(`${NAME}: ${changes.error}。適用しません。\n`);
    return false;
  }
  const summary = formatPlanSummary(changes);
  const title = `OpenTofuの計画(${session.env}・${phase})`;
  deps.stdout.write(`${title}:\n${summary}`);
  deps.github.summary(`### ${title}\n\n${summary}`);
  return true;
};

const apply = async (
  session: TofuSession,
  deps: DeliveryDeps,
): Promise<boolean> => {
  const env = await providerEnvOf(session, deps);
  const result = await runTofuStep(
    NAME,
    {
      args: [
        'apply',
        '-input=false',
        '-no-color',
        LOCK_TIMEOUT,
        planFileOf(session),
      ],
      env,
      output: 'filtered',
      filter: filterApplyOutput,
    },
    deps,
  );
  return result !== undefined;
};

export const command: DeliveryCommand = {
  name: NAME,
  description:
    '/ci/tofuの値とOIDCでOpenTofuを初期化し、段階(foundationはホスト名の割り当てを除く)の計画を要約してから適用する',
  run: async (args, deps) => {
    const { options } = parseOptions(args, {
      names: ['env', 'phase'],
      rest: 'none',
    });
    const env = requiredChoice(options, 'env', DEPLOY_ENVIRONMENTS);
    const phase = requiredChoice(options, 'phase', TOFU_PHASES);
    const session = await openTofuSession(NAME, env, deps);
    if (typeof session === 'number') return session;
    const succeeded =
      (await initTofu(NAME, session, deps)) !== undefined &&
      (await plan(session, phase, deps)) &&
      (await reportPlan(session, phase, deps)) &&
      (await apply(session, deps));
    if (!succeeded) return EXIT_FAILURE;
    deps.github.summary(`OpenTofuの適用(${env}・${phase})が完了しました。\n`);
    return EXIT_SUCCESS;
  },
};
