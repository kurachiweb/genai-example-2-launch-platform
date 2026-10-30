import {
  type AppDefinition,
  type AppName,
  APPS,
} from '../../../config/workspace-layout.ts';

import { packageJsonOf } from './install-targets.ts';

export interface AppCheck {
  readonly app: AppName;
  readonly script: string;
}

// 型の鮮度(cf-typegen:check)とGraphQLの生成物(graphql:check)は、品質の検査で先に実行するルートの一括検査が全アプリで確かめるため含めない
export const APP_CHECKS: readonly AppCheck[] = [
  { app: 'api', script: 'db:migrations:check' },
  { app: 'api', script: 'test:smoke' },
];

export interface AppCheckLayout {
  readonly apps: readonly AppDefinition[];
}

const WORKSPACE_LAYOUT: AppCheckLayout = { apps: APPS };

export interface AppCheckStep {
  readonly dir: string;
  readonly script: string;
}

export type AppCheckPlan =
  | { readonly ok: true; readonly steps: readonly AppCheckStep[] }
  | { readonly ok: false; readonly errors: readonly string[] };

const dirOf = (app: AppName, { apps }: AppCheckLayout): string => {
  const found = apps.find(({ name }) => name === app);
  if (found === undefined) {
    throw new Error(`アプリの一覧に${app}がありません。`);
  }
  return found.dir;
};

const stepsOf = (
  checks: readonly AppCheck[],
  layout: AppCheckLayout,
): readonly AppCheckStep[] =>
  checks.map(({ app, script }) => ({ dir: dirOf(app, layout), script }));

export function appCheckDirs(
  checks: readonly AppCheck[] = APP_CHECKS,
  layout: AppCheckLayout = WORKSPACE_LAYOUT,
): readonly string[] {
  return [...new Set(stepsOf(checks, layout).map(({ dir }) => dir))];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function scriptNamesOf(packageJson: unknown): readonly string[] {
  if (!isRecord(packageJson) || !isRecord(packageJson.scripts)) return [];
  return Object.entries(packageJson.scripts)
    .filter(([, command]) => typeof command === 'string')
    .map(([name]) => name);
}

export function planAppChecks(
  scriptsByDir: ReadonlyMap<string, readonly string[]>,
  checks: readonly AppCheck[] = APP_CHECKS,
  layout: AppCheckLayout = WORKSPACE_LAYOUT,
): AppCheckPlan {
  const steps = stepsOf(checks, layout);
  const errors = steps
    .filter(({ dir, script }) => !scriptsByDir.get(dir)?.includes(script))
    .map(
      ({ dir, script }) =>
        `${packageJsonOf(dir)}: スクリプト${script}がありません`,
    );
  return errors.length > 0 ? { ok: false, errors } : { ok: true, steps };
}
