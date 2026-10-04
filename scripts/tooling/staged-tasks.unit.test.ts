import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { AppName } from '../../config/workspace-layout.ts';
import {
  createWorkspaceChecks,
  describePlanError,
  type PlanError,
  type PlanResult,
  planStagedTasks,
  type StagedOwner,
  type StagedTaskPlan,
  toCommands,
} from './staged-tasks.ts';

const REPO_ROOT = '/repo';
const ROOT: StagedOwner = { kind: 'root' };
const appOwner = (app: AppName): StagedOwner => ({ kind: 'app', app });

const toAbsolute = (path: string): string => `${REPO_ROOT}/${path}`;

const planWith = (
  relativePaths: readonly string[],
  isInstalled: (owner: StagedOwner) => boolean = () => true,
  appExists: (app: AppName) => boolean = () => true,
): PlanResult =>
  planStagedTasks(
    relativePaths.map(toAbsolute),
    REPO_ROOT,
    isInstalled,
    appExists,
  );

const planOf = (relativePaths: readonly string[]): StagedTaskPlan => {
  const result = planWith(relativePaths);
  if (!result.ok) {
    throw new Error(`計画がエラーになった: ${JSON.stringify(result.errors)}`);
  }
  return result.plan;
};

const errorsOf = (result: PlanResult): readonly PlanError[] =>
  result.ok ? [] : result.errors;

describe('planStagedTasks', () => {
  test('mockups・外部由来・ロックファイルを静的解析と整形のどちらの対象にも含めない', () => {
    const plan = planOf([
      'mockups/src/routes/client/index.tsx',
      'mockups/README.md',
      '.claude/hooks/hook.ts',
      '.claude/settings.json',
      'docs/ai-extensions/cc-sdd.md',
      '.kiro/settings/templates/specs/design.md',
      'bun.lock',
      'apps/api/bun.lock',
    ]);

    expect(plan).toEqual({ lintGroups: [], formatTargets: [] });
  });

  test('除外するディレクトリと名前の先頭だけが一致する別のパスは除外しない', () => {
    const plan = planOf([
      'mockups.md',
      'docs/ai-extensions-notes.md',
      '.kiro/specs/dev-tooling/design.md',
      'bun.lock.md',
    ]);

    expect(plan.formatTargets).toEqual([
      'mockups.md',
      'docs/ai-extensions-notes.md',
      '.kiro/specs/dev-tooling/design.md',
      'bun.lock.md',
    ]);
  });

  test('apps/backend-libのTypeScriptをapps/api/lib配下へ読み替えてapiの所有にする', () => {
    const plan = planOf(['apps/backend-lib/utilities/date.ts']);

    expect(plan.lintGroups).toEqual([
      {
        owner: appOwner('api'),
        lintTargets: ['apps/api/lib/utilities/date.ts'],
      },
    ]);
  });

  test('apps/dbのTypeScriptをapps/api/db配下へ読み替えてapiの所有にする', () => {
    const plan = planOf(['apps/db/schema/users.ts']);

    expect(plan.lintGroups).toEqual([
      { owner: appOwner('api'), lintTargets: ['apps/api/db/schema/users.ts'] },
    ]);
  });

  test('apps/frontend-libのTypeScriptは読み替えずにfrontend-libの所有にする', () => {
    const plan = planOf(['apps/frontend-lib/components/button.tsx']);

    expect(plan.lintGroups).toEqual([
      {
        owner: appOwner('frontend-lib'),
        lintTargets: ['apps/frontend-lib/components/button.tsx'],
      },
    ]);
  });

  test.each<[string, AppName]>([
    ['apps/api/src/index.ts', 'api'],
    ['apps/event/src/index.ts', 'event'],
    ['apps/client/src/routes/index.tsx', 'client'],
    ['apps/admin/src/routes/index.tsx', 'admin'],
    ['apps/client/vite.config.ts', 'client'],
  ])('%sを%sの所有にする', (path, app) => {
    const plan = planOf([path]);

    expect(plan.lintGroups).toEqual([
      { owner: appOwner(app), lintTargets: [path] },
    ]);
  });

  test('ルート直下・config・scripts・e2e・test-supportのTypeScriptをルートの所有にする', () => {
    const paths = [
      'eslint.config.ts',
      'config/workspace-layout.ts',
      'scripts/tooling/staged-tasks.ts',
      'e2e/support/targets.ts',
      'test-support/module-references.ts',
    ];

    const plan = planOf(paths);

    expect(plan.lintGroups).toEqual([{ owner: ROOT, lintTargets: paths }]);
  });

  test('所有者ごとのグループをルート、アプリ一覧の順に並べ、グループ内はステージ順を保つ', () => {
    const plan = planOf([
      'apps/admin/src/a.tsx',
      'apps/client/src/b.tsx',
      'apps/backend-lib/c.ts',
      'scripts/d.ts',
      'apps/frontend-lib/e.tsx',
      'apps/event/src/f.ts',
      'apps/api/src/g.ts',
      'config/h.ts',
    ]);

    expect(plan.lintGroups).toEqual([
      { owner: ROOT, lintTargets: ['scripts/d.ts', 'config/h.ts'] },
      {
        owner: appOwner('api'),
        lintTargets: ['apps/api/lib/c.ts', 'apps/api/src/g.ts'],
      },
      { owner: appOwner('event'), lintTargets: ['apps/event/src/f.ts'] },
      {
        owner: appOwner('frontend-lib'),
        lintTargets: ['apps/frontend-lib/e.tsx'],
      },
      { owner: appOwner('client'), lintTargets: ['apps/client/src/b.tsx'] },
      { owner: appOwner('admin'), lintTargets: ['apps/admin/src/a.tsx'] },
    ]);
  });

  test('マークダウン・JSON・YAML・SQLなどは整形だけの対象にする', () => {
    const paths = [
      'README.md',
      'package.json',
      'compose.yaml',
      'apps/api/wrangler.jsonc',
      'apps/backend-lib/README.md',
      'apps/db/migrations/20260101000000_init/migration.sql',
    ];

    const plan = planOf(paths);

    expect(plan).toEqual({ lintGroups: [], formatTargets: paths });
  });

  test('整形の対象は除外後のすべてのファイルを、読み替えずに元のパスのままステージ順に持つ', () => {
    const plan = planOf([
      'apps/backend-lib/x.ts',
      'mockups/src/y.tsx',
      'docs/GUIDES/tech/README.md',
      'apps/db/schema/z.ts',
      'scripts/w.ts',
    ]);

    expect(plan.formatTargets).toEqual([
      'apps/backend-lib/x.ts',
      'docs/GUIDES/tech/README.md',
      'apps/db/schema/z.ts',
      'scripts/w.ts',
    ]);
  });

  test('アプリにも共有ディレクトリにも属さないapps配下のTypeScriptは、静的解析の対象から外し整形の対象には残す', () => {
    const paths = ['apps/infra/build.ts', 'apps/apiary/src/index.ts'];

    const plan = planOf(paths);

    expect(plan).toEqual({ lintGroups: [], formatTargets: paths });
  });

  test('ステージ済みのファイルが無ければ空の計画を返す', () => {
    expect(planOf([])).toEqual({ lintGroups: [], formatTargets: [] });
  });

  test('検査担当のapps/apiが未作成でapps/backend-libのTypeScriptがあれば、consumer-missingを返す', () => {
    const appExists = mock((app: AppName) => app !== 'api');

    const result = planWith(
      ['apps/backend-lib/utilities/date.ts'],
      () => true,
      appExists,
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          kind: 'consumer-missing',
          sharedDir: 'apps/backend-lib',
          consumer: 'api',
        },
      ],
    });
    expect(appExists).toHaveBeenCalledWith('api');
  });

  test('検査担当が未作成なら、共有ディレクトリごとにconsumer-missingを1つずつ返し、同じアプリのtooling-missingは重ねない', () => {
    const result = planWith(
      [
        'apps/db/schema/a.ts',
        'apps/backend-lib/b.ts',
        'apps/db/schema/c.ts',
        'apps/api/src/d.ts',
      ],
      () => false,
      () => false,
    );

    expect(errorsOf(result)).toEqual([
      { kind: 'consumer-missing', sharedDir: 'apps/db', consumer: 'api' },
      {
        kind: 'consumer-missing',
        sharedDir: 'apps/backend-lib',
        consumer: 'api',
      },
    ]);
  });

  test('検査担当が未作成でも、共有ディレクトリにTypeScriptが無ければエラーにしない', () => {
    const appExists = mock(() => false);

    const result = planWith(
      ['apps/backend-lib/README.md', 'apps/db/migrations/x/migration.sql'],
      () => true,
      appExists,
    );

    expect(result.ok).toBe(true);
    expect(appExists).not.toHaveBeenCalled();
  });

  test('検査担当が自身のapps/frontend-libは、アプリの作成有無を問わず品質ツールの導入だけを確かめる', () => {
    const appExists = mock(() => false);

    const result = planWith(
      ['apps/frontend-lib/components/button.tsx'],
      () => true,
      appExists,
    );

    expect(result.ok).toBe(true);
    expect(appExists).not.toHaveBeenCalled();
  });

  test('静的解析の対象を持つアプリに品質ツールが未導入なら、そのアプリでのbun installを案内するtooling-missingを返す', () => {
    const result = planWith(
      ['apps/client/src/routes/index.tsx'],
      (owner) => owner.kind === 'root',
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          kind: 'tooling-missing',
          owner: appOwner('client'),
          hint: 'apps/clientに静的解析ツールが導入されていません。`cd /repo/apps/client && bun install`を実行してください。',
        },
      ],
    });
  });

  test('ルートに品質ツールが未導入なら、ルートでのbun installを案内するtooling-missingを返す', () => {
    const result = planWith(['scripts/tooling/staged-tasks.ts'], () => false);

    expect(errorsOf(result)).toEqual([
      {
        kind: 'tooling-missing',
        owner: ROOT,
        hint: 'ルートに静的解析ツールが導入されていません。`cd /repo && bun install`を実行してください。',
      },
    ]);
  });

  test('品質ツールの導入は、静的解析の対象を持つ所有者だけを確かめる', () => {
    const isInstalled = mock<(owner: StagedOwner) => boolean>(() => true);

    planWith(
      ['README.md', 'apps/event/wrangler.jsonc', 'apps/api/src/index.ts'],
      isInstalled,
    );

    expect(isInstalled.mock.calls).toEqual([[appOwner('api')]]);
  });

  test('consumer-missingとtooling-missingを、consumer-missing、ルート、アプリ一覧の順にまとめて返す', () => {
    const result = planWith(
      ['apps/admin/src/a.tsx', 'apps/backend-lib/b.ts', 'config/c.ts'],
      () => false,
      (app) => app !== 'api',
    );

    expect(errorsOf(result).map((error) => error.kind)).toEqual([
      'consumer-missing',
      'tooling-missing',
      'tooling-missing',
    ]);
    expect(errorsOf(result)).toMatchObject([
      { sharedDir: 'apps/backend-lib', consumer: 'api' },
      { owner: ROOT },
      { owner: appOwner('admin') },
    ]);
  });
});

describe('toCommands', () => {
  test('所有者ごとのESLintをルート、アプリの順に並べ、最後にルートのPrettierへ整形対象を1回で渡す', () => {
    const plan = planOf([
      'apps/backend-lib/x.ts',
      'scripts/y.ts',
      'apps/client/src/z.tsx',
      'README.md',
    ]);

    expect(toCommands(plan, REPO_ROOT)).toEqual([
      'bun --bun /repo/node_modules/.bin/eslint --fix --no-warn-ignored /repo/scripts/y.ts',
      'bun --bun /repo/apps/api/node_modules/.bin/eslint --fix --no-warn-ignored /repo/apps/api/lib/x.ts',
      'bun --bun /repo/apps/client/node_modules/.bin/eslint --fix --no-warn-ignored /repo/apps/client/src/z.tsx',
      'bun --bun /repo/node_modules/.bin/prettier --write --ignore-unknown /repo/apps/backend-lib/x.ts /repo/scripts/y.ts /repo/apps/client/src/z.tsx /repo/README.md',
    ]);
  });

  test('静的解析の対象が無ければ、Prettierのコマンドだけを返す', () => {
    const plan = planOf(['README.md', 'compose.yaml']);

    expect(toCommands(plan, REPO_ROOT)).toEqual([
      'bun --bun /repo/node_modules/.bin/prettier --write --ignore-unknown /repo/README.md /repo/compose.yaml',
    ]);
  });

  test('ファイルの無いグループと空の整形対象にはコマンドを出さない', () => {
    const plan: StagedTaskPlan = {
      lintGroups: [{ owner: ROOT, lintTargets: [] }],
      formatTargets: [],
    };

    expect(toCommands(plan, REPO_ROOT)).toEqual([]);
  });

  test('空白や引用符を含むパスを引用符で囲み、1つの引数として渡す', () => {
    const plan: StagedTaskPlan = {
      lintGroups: [{ owner: ROOT, lintTargets: ["scripts/it's.ts"] }],
      formatTargets: ['docs/a b.md', 'docs/say "hi".md', "scripts/it's.ts"],
    };

    expect(toCommands(plan, '/my repo')).toEqual([
      `bun --bun "/my repo/node_modules/.bin/eslint" --fix --no-warn-ignored "/my repo/scripts/it's.ts"`,
      `bun --bun "/my repo/node_modules/.bin/prettier" --write --ignore-unknown "/my repo/docs/a b.md" '/my repo/docs/say "hi".md' "/my repo/scripts/it's.ts"`,
    ]);
  });

  test('シングルとダブルの引用符を両方含むパスは1つの引数として渡せないため、例外を投げる', () => {
    const plan: StagedTaskPlan = {
      lintGroups: [],
      formatTargets: [`docs/it's "quoted".md`],
    };

    expect(() => toCommands(plan, REPO_ROOT)).toThrow(
      `/repo/docs/it's "quoted".md`,
    );
  });
});

describe('describePlanError', () => {
  test('consumer-missingは共有ディレクトリと検査担当アプリを示し、アプリの作成とbun installを案内する', () => {
    const message = describePlanError(
      { kind: 'consumer-missing', sharedDir: 'apps/db', consumer: 'api' },
      REPO_ROOT,
    );

    expect(message).toBe(
      'apps/dbのTypeScriptを検査するアプリapps/apiがまだ作成されていません。apps/apiを作成し、`cd /repo/apps/api && bun install`を実行してください。',
    );
  });

  test('tooling-missingは案内文をそのまま返す', () => {
    const message = describePlanError(
      { kind: 'tooling-missing', owner: ROOT, hint: '案内文' },
      REPO_ROOT,
    );

    expect(message).toBe('案内文');
  });
});

describe('createWorkspaceChecks', () => {
  let workspace = '';

  const touch = async (path: string): Promise<void> => {
    await mkdir(dirname(join(workspace, path)), { recursive: true });
    await writeFile(join(workspace, path), '');
  };

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'staged-tasks-test-'));
    await Promise.all([
      touch('node_modules/.bin/eslint'),
      touch('apps/api/package.json'),
      touch('apps/api/node_modules/.bin/eslint'),
      touch('apps/event/package.json'),
      touch('apps/client/src/index.tsx'),
    ]);
  });

  afterAll(async () => {
    if (workspace !== '') {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('isInstalledは所有者のnode_modules/.bin/eslintがあるときだけtrueを返す', () => {
    const { isInstalled } = createWorkspaceChecks(workspace);

    expect(isInstalled(ROOT)).toBe(true);
    expect(isInstalled(appOwner('api'))).toBe(true);
    expect(isInstalled(appOwner('event'))).toBe(false);
    expect(isInstalled(appOwner('client'))).toBe(false);
  });

  test('appExistsはアプリのpackage.jsonがあるときだけtrueを返す', () => {
    const { appExists } = createWorkspaceChecks(workspace);

    expect(appExists('api')).toBe(true);
    expect(appExists('event')).toBe(true);
    expect(appExists('client')).toBe(false);
    expect(appExists('admin')).toBe(false);
  });
});
