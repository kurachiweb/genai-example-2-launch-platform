import { describe, expect, test } from 'bun:test';

import type { CommandRunner, CommandSpec } from '../adapters/command-runner.ts';
import { filterApplyOutput } from '../core/apply-output.ts';
import type { SecretEntry } from '../core/secret-scope.ts';
import { commandLineOf } from '../test-fixtures/command-runner.ts';
import {
  CATALOG_AUDIENCE,
  CATALOG_HOST,
  FAKE_OIDC_TOKEN,
  PROD_IDENTITY_ID,
  STAGING_IDENTITY_ID,
  createFakeSecretSource,
  createRecordingGithub,
  folderKeyOf,
  infisicalRepoTexts,
} from '../test-fixtures/infisical.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import {
  FAKE_REPO_ROOT,
  createFakeDeps,
  createFakeRepoFiles,
  withoutPath,
} from '../test-fixtures/repo-files.ts';
import { PROJECT_ID } from '../test-fixtures/resource-catalog.ts';
import {
  CREATE_ONLY_PLAN_JSON,
  D1_ADDRESS,
  PLAN_SECRET_VALUES,
  QUEUE_ADDRESS,
  R2_ADDRESS,
  planJsonOf,
} from '../test-fixtures/tofu-plan.ts';
import { EXIT_FAILURE, EXIT_SUCCESS } from './shared/delivery-command.ts';
import { command } from './tofu.ts';

const TOFU_FOLDER: readonly SecretEntry[] = [
  { key: 'AWS_ACCESS_KEY_ID', value: 'fake-state-access-key-id' },
  { key: 'AWS_SECRET_ACCESS_KEY', value: 'fake-state-secret-access-key' },
  { key: 'TF_VAR_state_passphrase', value: 'fake-state-passphrase-value' },
];

const STATE_ENV: Readonly<Record<string, string>> = {
  AWS_ACCESS_KEY_ID: 'fake-state-access-key-id',
  AWS_SECRET_ACCESS_KEY: 'fake-state-secret-access-key',
  TF_VAR_state_passphrase: 'fake-state-passphrase-value',
};

const PLAN_TEXT = `OpenTofu will perform the following actions:
  + secret = "fake-turnstile-secret-value"
Plan: 1 to add, 0 to change, 0 to destroy.
`;

const APPLY_OUTPUT_LINES: readonly string[] = [
  `${D1_ADDRESS}: Creating...`,
  '  secret = "fake-turnstile-secret-value"',
  `${D1_ADDRESS}: Creation complete after 2s [id=abc]`,
  'Apply complete! Resources: 1 added, 0 changed, 0 destroyed.',
  'resource_ids = { "turnstile_sitekey" = "fake-prior-hostname-value" }',
];

const SECRET_VALUES: readonly string[] = [
  ...TOFU_FOLDER.map(({ value }) => value),
  FAKE_OIDC_TOKEN,
  ...PLAN_SECRET_VALUES,
];

const LIVE = '-chdir=apps/infra/live';

type Step = 'init' | 'plan' | 'show' | 'apply';

const stepOf = (spec: CommandSpec): Step | undefined =>
  (['init', 'plan', 'show', 'apply'] as const).find(
    (step) => spec.args[1] === step,
  );

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly folders?: Readonly<Record<string, readonly SecretEntry[]>>;
  readonly texts?: Readonly<Record<string, string>>;
  readonly failAt?: Step;
  readonly planJson?: string;
  readonly applyStderr?: string;
}

const runWith = async (
  args: readonly string[],
  {
    env = { INFISICAL_TOKEN: 'fake-access-token' },
    folders = {
      [folderKeyOf('staging', '/ci/tofu')]: TOFU_FOLDER,
      [folderKeyOf('prod', '/ci/tofu')]: TOFU_FOLDER,
    },
    texts = infisicalRepoTexts(),
    failAt,
    planJson = CREATE_ONLY_PLAN_JSON,
    applyStderr,
  }: RunOptions = {},
) => {
  const timeline: string[] = [];
  const calls: CommandSpec[] = [];
  const fake = createFakeDeps(createFakeRepoFiles(texts));
  const runner: CommandRunner = {
    run: (spec) => {
      calls.push(spec);
      timeline.push(`run:${commandLineOf(spec)}`);
      const step = stepOf(spec);
      if (step === 'apply') {
        for (const line of APPLY_OUTPUT_LINES) {
          const shown = spec.filter?.(line);
          if (shown !== undefined) fake.stdout.write(`${shown}\n`);
        }
      }
      return Promise.resolve({
        code: step === failAt ? 1 : 0,
        stdout: step === 'plan' ? PLAN_TEXT : step === 'show' ? planJson : '',
        stderr:
          step === 'apply' && applyStderr !== undefined
            ? applyStderr
            : failAt !== undefined && step === failAt
              ? `Error: ${failAt}の診断のメッセージ\n`
              : '',
      });
    },
    start: () => {
      throw new Error('常駐の起動は使わない');
    },
  };
  const code = await command.run(args, {
    ...fake.deps,
    env,
    runner,
    github: createRecordingGithub(timeline),
    secrets: createFakeSecretSource({ timeline, folders }),
  });
  const shown = [
    fake.stdout.text(),
    fake.stderr.text(),
    ...timeline.filter((event) => event.startsWith('summary:')),
  ].join('\n');
  const callOf = (step: Step): CommandSpec | undefined =>
    calls.find((spec) => stepOf(spec) === step);
  return { ...fake, code, timeline, calls, shown, callOf };
};

const expectNoSecretShown = (shown: string): void => {
  for (const value of SECRET_VALUES) expect(shown).not.toContain(value);
};

const providerEnvOf = (identityId: string): Record<string, string> => ({
  ...STATE_ENV,
  INFISICAL_AUTH_METHOD: 'oidc',
  INFISICAL_MACHINE_IDENTITY_ID: identityId,
  INFISICAL_AUTH_JWT: FAKE_OIDC_TOKEN,
});

describe('tofu', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('tofu');
    expect(command.description).not.toBe('');
  });

  test('1段目は/ci/tofuの値をマスクしてから、初期化→ホスト名の割り当てを除いた計画→計画の要約→適用の順に呼ぶ', async () => {
    const { code, timeline } = await runWith([
      '--env',
      'staging',
      '--phase',
      'foundation',
    ]);

    expect(code).toBe(EXIT_SUCCESS);
    const events = timeline.map((event) =>
      event.startsWith('summary:') ? 'summary' : event,
    );
    expect(events).toEqual([
      `export:${PROJECT_ID}:staging:/ci/tofu:${CATALOG_HOST}`,
      'mask:fake-state-access-key-id',
      'mask:fake-state-secret-access-key',
      'mask:fake-state-passphrase-value',
      `run:tofu ${LIVE} init -input=false -reconfigure -backend-config=../backends/staging.s3.hcl`,
      `oidc:${CATALOG_AUDIENCE}`,
      `mask:${FAKE_OIDC_TOKEN}`,
      `run:tofu ${LIVE} plan -input=false -no-color -lock-timeout=5m -var environment=staging -exclude=module.worker_routing -out=staging.tfplan`,
      `run:tofu ${LIVE} show -json staging.tfplan`,
      'summary',
      `oidc:${CATALOG_AUDIENCE}`,
      `mask:${FAKE_OIDC_TOKEN}`,
      `run:tofu ${LIVE} apply -input=false -no-color -lock-timeout=5m staging.tfplan`,
      'summary',
    ]);
  });

  test('2段目はホスト名の割り当てを除かずに計画する', async () => {
    const { code, callOf } = await runWith([
      '--env',
      'staging',
      '--phase',
      'routing',
    ]);

    expect(code).toBe(EXIT_SUCCESS);
    expect(callOf('plan')?.args).toEqual([
      LIVE,
      'plan',
      '-input=false',
      '-no-color',
      '-lock-timeout=5m',
      '-var',
      'environment=staging',
      '-out=staging.tfplan',
    ]);
  });

  test('/ci/tofuの値と新しいOIDCのトークンは子プロセスの環境変数だけに渡し、後続の手順の環境変数へ書き出さない', async () => {
    const { callOf, timeline } = await runWith([
      '--env',
      'staging',
      '--phase',
      'foundation',
    ]);

    expect(callOf('init')?.env).toEqual(STATE_ENV);
    expect(callOf('plan')?.env).toEqual(providerEnvOf(STAGING_IDENTITY_ID));
    expect(callOf('show')?.env).toEqual(STATE_ENV);
    expect(callOf('apply')?.env).toEqual(providerEnvOf(STAGING_IDENTITY_ID));
    expect(timeline.some((event) => event.startsWith('exportEnv:'))).toBe(
      false,
    );
  });

  test('リポジトリのルートで実行し、計画とJSONの出力は取り込んで表示せず、適用の出力は資源の行と完了の行だけを表示する', async () => {
    const { calls, callOf, stdout, shown } = await runWith([
      '--env',
      'staging',
      '--phase',
      'foundation',
    ]);

    expect(calls.every((spec) => spec.cwd === FAKE_REPO_ROOT)).toBe(true);
    expect(callOf('init')?.output).toBe('inherit');
    expect(callOf('plan')?.output).toBe('capture');
    expect(callOf('show')?.output).toBe('capture');
    expect(callOf('apply')?.output).toBe('filtered');
    expect(callOf('apply')?.filter).toBe(filterApplyOutput);
    expect(stdout.text()).toContain(`- create: \`${D1_ADDRESS}\``);
    expect(stdout.text()).toContain(
      `${D1_ADDRESS}: Creation complete after 2s [id=abc]\nApply complete! Resources: 1 added, 0 changed, 0 destroyed.\n`,
    );
    expect(stdout.text()).not.toContain(QUEUE_ADDRESS);
    expect(shown).not.toContain('OpenTofu will perform the following actions');
    expect(shown).not.toContain('resource_ids');
    expectNoSecretShown(shown);
  });

  test('計画の要約を手順の要約に書き、削除と作り直しがあれば先頭に警告を付ける', async () => {
    const { code, timeline, stdout } = await runWith(
      ['--env', 'staging', '--phase', 'foundation'],
      {
        planJson: planJsonOf([
          [D1_ADDRESS, ['delete', 'create']],
          [R2_ADDRESS, ['delete']],
        ]),
      },
    );

    expect(code).toBe(EXIT_SUCCESS);
    const summaries = timeline.filter((event) => event.startsWith('summary:'));
    expect(summaries[0]).toStartWith(
      'summary:### OpenTofuの計画(staging・foundation)\n\n警告: 計画に削除または作り直しが2件あります',
    );
    expect(summaries[0]).toContain(`- delete: \`${R2_ADDRESS}\``);
    expect(summaries[1]).toBe(
      'summary:OpenTofuの適用(staging・foundation)が完了しました。\n',
    );
    expect(stdout.text()).toContain(
      '警告: 計画に削除または作り直しが2件あります',
    );
  });

  test('prodでは資源一覧のprodの主体・prodの/ci/tofu・prodのbackend設定を使う', async () => {
    const { code, timeline, callOf } = await runWith([
      '--env',
      'prod',
      '--phase',
      'routing',
    ]);

    expect(code).toBe(EXIT_SUCCESS);
    expect(timeline[0]).toBe(
      `export:${PROJECT_ID}:prod:/ci/tofu:${CATALOG_HOST}`,
    );
    expect(callOf('init')?.args).toContain(
      '-backend-config=../backends/prod.s3.hcl',
    );
    expect(callOf('plan')?.args).toContain('environment=prod');
    expect(callOf('plan')?.env).toEqual(providerEnvOf(PROD_IDENTITY_ID));
    expect(callOf('apply')?.args.at(-1)).toBe('prod.tfplan');
  });

  test('INFISICAL_TOKENが無ければ、取り出しと子プロセスを起動せずに失敗する', async () => {
    const { code, timeline, calls, stderr } = await runWith(
      ['--env', 'staging', '--phase', 'foundation'],
      { env: {} },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([]);
    expect(calls).toEqual([]);
    expect(stderr.text()).toBe(
      'tofu: INFISICAL_TOKENがありません。先に`infisical-login --scope staging`を実行してください。\n',
    );
  });

  test('/ci/tofuを取り出せなければ、フォルダの名前だけを表示して子プロセスを起動せずに失敗する', async () => {
    const { code, calls, stderr } = await runWith(
      ['--env', 'staging', '--phase', 'foundation'],
      { folders: {} },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toBe(
      'tofu: Infisicalのstagingのフォルダ/ci/tofuを取り出せませんでした(終了コード1)\n',
    );
  });

  test('/ci/tofuに必要なキーが無ければ、キー名だけを表示して子プロセスを起動せずに失敗する', async () => {
    const { code, calls, stderr, shown } = await runWith(
      ['--env', 'staging', '--phase', 'foundation'],
      {
        folders: {
          [folderKeyOf('staging', '/ci/tofu')]: TOFU_FOLDER.slice(0, 1),
        },
      },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toBe(
      'tofu: Infisicalのstagingのフォルダ/ci/tofuにキーがありません: AWS_SECRET_ACCESS_KEY・TF_VAR_state_passphrase\n',
    );
    expectNoSecretShown(shown);
  });

  test('資源一覧を読み込めなければ、入力の誤りとして出して失敗する', async () => {
    const { code, calls, stderr } = await runWith(
      ['--env', 'staging', '--phase', 'foundation'],
      {
        texts: withoutPath(
          infisicalRepoTexts(),
          'apps/infra/environments/staging.json',
        ),
      },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls).toEqual([]);
    expect(stderr.text()).toContain(
      'OpenTofuの実行: 検査の入力を読み込めません。',
    );
  });

  test.each([
    ['init', ['init']],
    ['plan', ['init', 'plan']],
    ['show', ['init', 'plan', 'show']],
    ['apply', ['init', 'plan', 'show', 'apply']],
  ] as const)(
    '%sが失敗したら後続を実行せず、失敗した手順を表示して終了コード1を返す',
    async (failAt, expectedSteps) => {
      const { code, calls, stderr, shown } = await runWith(
        ['--env', 'staging', '--phase', 'foundation'],
        { failAt },
      );

      expect(code).toBe(EXIT_FAILURE);
      expect(calls.map(stepOf)).toEqual([...expectedSteps]);
      expect(stderr.text()).toContain(`tofu: tofu ${LIVE} ${failAt}`);
      expect(stderr.text()).toContain('が終了コード1で失敗しました。');
      expectNoSecretShown(shown);
    },
  );

  test('計画と計画のJSONの取り込みが失敗したら、計画の本文を出さずに診断(標準エラー出力)だけを表示する', async () => {
    const plan = await runWith(['--env', 'staging', '--phase', 'foundation'], {
      failAt: 'plan',
    });
    const show = await runWith(['--env', 'staging', '--phase', 'foundation'], {
      failAt: 'show',
    });

    expect(plan.stderr.text()).toContain('Error: planの診断のメッセージ');
    expect(show.stderr.text()).toContain('Error: showの診断のメッセージ');
    expect(plan.shown).not.toContain('OpenTofu will perform');
    expect(show.shown).not.toContain('format_version');
  });

  test('適用が失敗した時だけ、資源の行と完了の行に続けて標準エラー出力の診断を表示する', async () => {
    const diagnostic = [
      'Error: creating D1 database failed',
      '',
      `  with ${D1_ADDRESS},`,
      '  on ../modules/storage/main.tf line 1:',
      '',
    ].join('\n');

    const { code, stdout, stderr } = await runWith(
      ['--env', 'staging', '--phase', 'foundation'],
      { failAt: 'apply', applyStderr: diagnostic },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(stdout.text()).toContain(
      `${D1_ADDRESS}: Creation complete after 2s [id=abc]\n`,
    );
    expect(stderr.text()).toBe(
      `${diagnostic}tofu: tofu ${LIVE} apply -input=false -no-color -lock-timeout=5m staging.tfplan が終了コード1で失敗しました。\n`,
    );
  });

  test('適用が成功した時は、標準エラー出力に何かあっても資源の行と完了の行だけを表示する', async () => {
    const { code, stderr, shown } = await runWith(
      ['--env', 'staging', '--phase', 'foundation'],
      { applyStderr: 'Error: fake-turnstile-secret-value\n' },
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(stderr.text()).toBe('');
    expectNoSecretShown(shown);
  });

  test('計画のJSONを要約できなければ、適用せずに失敗する', async () => {
    const { code, calls, stderr, shown } = await runWith(
      ['--env', 'staging', '--phase', 'foundation'],
      { planJson: '{"secret": "fake-turnstile-secret-value"' },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls.map(stepOf)).toEqual(['init', 'plan', 'show']);
    expect(stderr.text()).toBe(
      'tofu: 計画のJSONを解析できません。適用しません。\n',
    );
    expectNoSecretShown(shown);
  });

  test.each([
    [[], '--envを指定してください(staging・prod)'],
    [['--env', 'staging'], '--phaseを指定してください(foundation・routing)'],
    [
      ['--env', 'dev', '--phase', 'foundation'],
      '--envはstaging・prodのいずれかにしてください(実際: dev)',
    ],
    [
      ['--env', 'staging', '--phase', 'all'],
      '--phaseはfoundation・routingのいずれかにしてください(実際: all)',
    ],
  ])('引数%pの誤りを使い方の誤りとして投げる', async (args, message) => {
    const fake = createFakeDeps(createFakeRepoFiles(infisicalRepoTexts()));

    expect(await rejectionMessageOf(command.run(args, fake.deps))).toBe(
      message,
    );
  });
});
