import { describe, expect, test } from 'bun:test';

import {
  INFRA_CONFIG_PATTERNS,
  INFRA_TEST_PATTERNS,
  planInfraCheck,
} from './infra-check-plan.ts';

const argsOf = (steps: ReturnType<typeof planInfraCheck>): readonly string[] =>
  steps.map(({ args }) => args.join(' '));

const initOf = (dir: string): string =>
  `-chdir=${dir} init -backend=false -lockfile=readonly -input=false`;

describe('planInfraCheck', () => {
  test('整形の検査の後に、ルートモジュールを先頭に各ディレクトリの初期化・妥当性の検査・テストを順に並べる', () => {
    const steps = planInfraCheck({
      configFiles: [
        'apps/infra/modules/storage/main.tf',
        'apps/infra/live/main.tf',
        'apps/infra/modules/messaging/main.tf',
      ],
      testFiles: [
        'apps/infra/modules/storage/tests/storage.tftest.hcl',
        'apps/infra/live/tests/live.tftest.hcl',
        'apps/infra/modules/messaging/tests/messaging.tftest.hcl',
      ],
    });

    expect(steps.every(({ command }) => command === 'tofu')).toBe(true);
    expect(argsOf(steps)).toEqual([
      'fmt -check -recursive apps/infra',
      initOf('apps/infra/live'),
      '-chdir=apps/infra/live validate',
      '-chdir=apps/infra/live test',
      initOf('apps/infra/modules/messaging'),
      '-chdir=apps/infra/modules/messaging validate',
      '-chdir=apps/infra/modules/messaging test',
      initOf('apps/infra/modules/storage'),
      '-chdir=apps/infra/modules/storage validate',
      '-chdir=apps/infra/modules/storage test',
    ]);
  });

  test('同じディレクトリの複数のファイルは1つのディレクトリにまとめる', () => {
    const steps = planInfraCheck({
      configFiles: [
        'apps/infra/live/main.tf',
        'apps/infra/live/versions.tf',
        'apps/infra/live/outputs.tf',
      ],
      testFiles: [
        'apps/infra/live/tests/a.tftest.hcl',
        'apps/infra/live/tests/b.tftest.hcl',
      ],
    });

    expect(argsOf(steps)).toEqual([
      'fmt -check -recursive apps/infra',
      initOf('apps/infra/live'),
      '-chdir=apps/infra/live validate',
      '-chdir=apps/infra/live test',
    ]);
  });

  test('テストを持たないディレクトリではテストを実行しない', () => {
    const steps = planInfraCheck({
      configFiles: [
        'apps/infra/live/main.tf',
        'apps/infra/modules/edge-services/main.tf',
      ],
      testFiles: ['apps/infra/live/tests/live.tftest.hcl'],
    });

    expect(argsOf(steps)).toEqual([
      'fmt -check -recursive apps/infra',
      initOf('apps/infra/live'),
      '-chdir=apps/infra/live validate',
      '-chdir=apps/infra/live test',
      initOf('apps/infra/modules/edge-services'),
      '-chdir=apps/infra/modules/edge-services validate',
    ]);
  });

  test('ディレクトリの直下に置いたテストのファイルもテストを持つとみなす', () => {
    const steps = planInfraCheck({
      configFiles: [
        'apps/infra/live/main.tf',
        'apps/infra/modules/worker-routing/main.tf',
      ],
      testFiles: ['apps/infra/modules/worker-routing/routing.tftest.hcl'],
    });

    expect(argsOf(steps)).toEqual([
      'fmt -check -recursive apps/infra',
      initOf('apps/infra/live'),
      '-chdir=apps/infra/live validate',
      initOf('apps/infra/modules/worker-routing'),
      '-chdir=apps/infra/modules/worker-routing validate',
      '-chdir=apps/infra/modules/worker-routing test',
    ]);
  });

  test('名前の前方が一致するだけの別のディレクトリのテストは数えない', () => {
    const steps = planInfraCheck({
      configFiles: [
        'apps/infra/live/main.tf',
        'apps/infra/modules/storage/main.tf',
        'apps/infra/modules/storage-archive/main.tf',
      ],
      testFiles: ['apps/infra/modules/storage-archive/tests/a.tftest.hcl'],
    });

    expect(argsOf(steps)).not.toContain(
      '-chdir=apps/infra/modules/storage test',
    );
    expect(argsOf(steps)).toContain(
      '-chdir=apps/infra/modules/storage-archive test',
    );
  });

  test('ルートモジュールの定義が無ければ失敗する', () => {
    expect(() =>
      planInfraCheck({
        configFiles: ['apps/infra/modules/storage/main.tf'],
        testFiles: [],
      }),
    ).toThrow('ルートモジュール(apps/infra/live)の定義が見つかりません。');
  });

  test('定義とテストの探索の対象は、ルートモジュールとモジュールのディレクトリの直下とその`tests`に限る', () => {
    expect(INFRA_CONFIG_PATTERNS).toEqual([
      'apps/infra/live/*.tf',
      'apps/infra/modules/*/*.tf',
    ]);
    expect(INFRA_TEST_PATTERNS).toEqual([
      'apps/infra/live/*.tftest.hcl',
      'apps/infra/live/tests/*.tftest.hcl',
      'apps/infra/modules/*/*.tftest.hcl',
      'apps/infra/modules/*/tests/*.tftest.hcl',
    ]);
  });
});
