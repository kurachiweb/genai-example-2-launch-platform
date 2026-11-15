import { describe, expect, test } from 'bun:test';

import type { CommandSpec } from '../adapters/command-runner.ts';
import type { HttpProbe, HttpProbeResult } from '../adapters/http-probe.ts';
import {
  type CommandOutputs,
  createRecordingRunner,
} from '../test-fixtures/command-runner.ts';
import { infisicalRepoTexts } from '../test-fixtures/infisical.ts';
import {
  playwrightListJson,
  smokeSpec,
} from '../test-fixtures/playwright-list.ts';
import {
  FAKE_REPO_ROOT,
  createFakeDeps,
  createFakeRepoFiles,
  withoutPath,
} from '../test-fixtures/repo-files.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';
import { command } from './verify.ts';

const TEN_MINUTES_MS = 600_000;

const STAGING_API_HEALTH = 'https://api-staging.launch.example/health';
const PROD_API_HEALTH = 'https://api-prod.launch.example/health';
const PROD_EVENT_HEALTH = 'https://event-prod.launch.example/health';
const PROD_CLIENT_TOP = 'https://client-prod.launch.example/';

const SMOKE_LINE = 'bun run test:e2e --grep @smoke';
const LIST_LINE = `${SMOKE_LINE} --list --reporter=json`;

const isListing = (spec: CommandSpec): boolean => spec.args.includes('--list');

const TWO_SMOKE_TESTS = playwrightListJson([
  smokeSpec('疎通確認の画面を表示する'),
  smokeSpec('存在しないページは404'),
]);

interface VerifyOptions {
  readonly texts?: Readonly<Record<string, string>>;
  readonly probeResultOf?: (url: string) => HttpProbeResult;
  readonly exitCodeOf?: (spec: CommandSpec) => number;
  readonly listOutputs?: CommandOutputs;
}

const createVerify = ({
  texts = infisicalRepoTexts(),
  probeResultOf = () => ({ reached: true, lastStatus: 200 }),
  exitCodeOf = () => 0,
  listOutputs = { stdout: TWO_SMOKE_TESTS },
}: VerifyOptions = {}) => {
  const timeline: string[] = [];
  const waits: { url: string; timeoutMs: number; expectStatus: unknown }[] = [];
  const recording = createRecordingRunner(
    (spec) => {
      timeline.push(`run:${[spec.command, ...spec.args].join(' ')}`);
      return exitCodeOf(spec);
    },
    (spec) => (isListing(spec) ? listOutputs : {}),
  );
  const probe: HttpProbe = {
    waitFor: (url, { timeoutMs, expectStatus }) => {
      waits.push({ url, timeoutMs, expectStatus });
      timeline.push(`wait:${url}`);
      return Promise.resolve(probeResultOf(url));
    },
  };
  const fake = createFakeDeps(createFakeRepoFiles(texts));
  const deps = { ...fake.deps, runner: recording.runner, probe };
  return {
    deps,
    stdout: fake.stdout,
    stderr: fake.stderr,
    summaries: fake.summaries,
    timeline: () => [...timeline],
    waits: () => [...waits],
    runs: recording.calls,
  };
};

describe('verify --env staging', () => {
  test('同じ絞り込みで`@smoke`のE2Eの件数を数え、apiのヘルスチェックの200を10分まで待ってから、stagingのURLを渡して`@smoke`のE2Eをルートで実行する', async () => {
    const verify = createVerify();

    const code = await command.run(['--env', 'staging'], verify.deps);

    expect(code).toBe(EXIT_SUCCESS);
    expect(verify.timeline()).toEqual([
      `run:${LIST_LINE}`,
      `wait:${STAGING_API_HEALTH}`,
      `run:${SMOKE_LINE}`,
    ]);
    expect(verify.waits()).toEqual([
      { url: STAGING_API_HEALTH, timeoutMs: TEN_MINUTES_MS, expectStatus: 200 },
    ]);
    const stagingUrls = {
      E2E_CLIENT_URL: 'https://client-staging.launch.example',
      E2E_ADMIN_URL: 'https://admin-staging.launch.example',
    };
    const [listing, smoke] = verify.runs();
    expect(listing?.cwd).toBe(FAKE_REPO_ROOT);
    expect(listing?.output).toBe('capture');
    expect(listing?.env).toEqual(stagingUrls);
    expect(smoke?.cwd).toBe(FAKE_REPO_ROOT);
    expect(smoke?.output).toBe('inherit');
    expect(smoke?.env).toEqual(stagingUrls);
    expect(verify.stdout.text()).toContain('`@smoke`のE2E: 2件');
    expect(verify.summaries().join('')).toContain('スモークテスト');
    expect(verify.summaries().join('')).toContain('2件');
  });

  test('到達確認のsetupを除いた`@smoke`のE2Eが0件なら、絞り込みと理由を標準エラーと要約に示し、待ち合わせもE2Eの実行もせずに失敗する', async () => {
    const verify = createVerify({
      listOutputs: { stdout: playwrightListJson([]) },
    });

    const code = await command.run(['--env', 'staging'], verify.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(verify.timeline()).toEqual([`run:${LIST_LINE}`]);
    expect(verify.waits()).toEqual([]);
    const stderr = verify.stderr.text();
    expect(stderr).toContain('--grep @smoke');
    expect(stderr).toContain('0件');
    expect(stderr).toContain('--pass-with-no-tests');
    const summary = verify.summaries().join('');
    expect(summary).toContain('--grep @smoke');
    expect(summary).toContain('0件');
  });

  test('件数の一覧の作成が失敗すれば、終了コードと標準エラーを示してE2Eを実行せずに失敗する', async () => {
    const verify = createVerify({
      exitCodeOf: (spec) => (isListing(spec) ? 1 : 0),
      listOutputs: {
        stdout: '',
        stderr: 'Error: playwright.config.tsを読めません',
      },
    });

    const code = await command.run(['--env', 'staging'], verify.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(verify.runs()).toHaveLength(1);
    const stderr = verify.stderr.text();
    expect(stderr).toContain(LIST_LINE);
    expect(stderr).toContain('終了コード1');
    expect(stderr).toContain('playwright.config.tsを読めません');
    expect(verify.summaries().join('')).toContain('終了コード1');
  });

  test('件数の一覧の形が読めなければ、その理由を示してE2Eを実行せずに失敗する', async () => {
    const verify = createVerify({
      listOutputs: { stdout: 'Total: 25 tests in 3 files' },
    });

    const code = await command.run(['--env', 'staging'], verify.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(verify.runs()).toHaveLength(1);
    expect(verify.stderr.text()).toContain('数えられません');
    expect(verify.summaries().join('')).toContain('数えられません');
  });

  test('apiのヘルスチェックが10分以内に200にならなければ、対象と最後の状態コードを表示し、E2Eを実行せずに失敗する', async () => {
    const verify = createVerify({
      probeResultOf: () => ({ reached: false, lastStatus: 526 }),
    });

    const code = await command.run(['--env', 'staging'], verify.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(verify.runs().filter((spec) => !isListing(spec))).toEqual([]);
    expect(verify.stderr.text()).toContain(
      `- ${STAGING_API_HEALTH}: 10分以内に200を返しませんでした(最後の状態コード: 526)`,
    );
    expect(verify.summaries().join('')).toContain(STAGING_API_HEALTH);
  });

  test('`@smoke`のE2Eが失敗すれば、対象のURLとその終了コードを表示して失敗する', async () => {
    const verify = createVerify({
      exitCodeOf: (spec) => (isListing(spec) ? 0 : 1),
    });

    const code = await command.run(['--env', 'staging'], verify.deps);

    expect(code).toBe(EXIT_FAILURE);
    const stderr = verify.stderr.text();
    expect(stderr).toContain(
      `スモークテスト(${SMOKE_LINE})が終了コード1で失敗しました`,
    );
    expect(stderr).toContain('https://client-staging.launch.example');
    expect(stderr).toContain('https://admin-staging.launch.example');
    expect(verify.summaries().join('')).toContain('終了コード1で失敗');
  });
});

describe('verify --env prod', () => {
  test('apiとeventのヘルスチェックとclientのトップページの200をそれぞれ10分まで待ち、子プロセスを起動しない', async () => {
    const verify = createVerify();

    const code = await command.run(['--env', 'prod'], verify.deps);

    expect(code).toBe(EXIT_SUCCESS);
    expect(verify.waits()).toEqual(
      [PROD_API_HEALTH, PROD_EVENT_HEALTH, PROD_CLIENT_TOP].map((url) => ({
        url,
        timeoutMs: TEN_MINUTES_MS,
        expectStatus: 200,
      })),
    );
    expect(verify.runs()).toEqual([]);
    expect(verify.stdout.text()).toContain(PROD_CLIENT_TOP);
    expect(verify.summaries().join('')).toContain(PROD_EVENT_HEALTH);
  });

  test('上限までに200にならない対象があれば、すべての対象を確かめた上で、届かなかった対象と状態を表示して失敗する', async () => {
    const verify = createVerify({
      probeResultOf: (url) => {
        if (url === PROD_EVENT_HEALTH)
          return { reached: false, lastStatus: 500 };
        if (url === PROD_CLIENT_TOP) {
          return { reached: false, lastStatus: undefined };
        }
        return { reached: true, lastStatus: 200 };
      },
    });

    const code = await command.run(['--env', 'prod'], verify.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(verify.waits()).toHaveLength(3);
    const stderr = verify.stderr.text();
    expect(stderr).toContain(
      `- ${PROD_EVENT_HEALTH}: 10分以内に200を返しませんでした(最後の状態コード: 500)`,
    );
    expect(stderr).toContain(
      `- ${PROD_CLIENT_TOP}: 10分以内に200を返しませんでした(応答がありませんでした)`,
    );
    expect(stderr).not.toContain(`- ${PROD_API_HEALTH}`);
    expect(verify.summaries().join('')).toContain(PROD_CLIENT_TOP);
  });
});

describe('verify の入力', () => {
  test.each([[[]], [['--env', 'dev']], [['--env', 'staging', '--', 'x']]])(
    '環境の指定が無いか誤っていれば引数の誤りにする(%j)',
    async (args: readonly string[]) => {
      const verify = createVerify();

      const error = await command
        .run(args, verify.deps)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UsageError);
      expect(verify.waits()).toEqual([]);
    },
  );

  test('資源一覧を読めなければ、待ち合わせも子プロセスも行わずに前提の不足で失敗する', async () => {
    const verify = createVerify({
      texts: withoutPath(
        infisicalRepoTexts(),
        'apps/infra/environments/staging.json',
      ),
    });

    const code = await command.run(['--env', 'staging'], verify.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(verify.stderr.text()).toContain(
      'apps/infra/environments/staging.json',
    );
    expect(verify.waits()).toEqual([]);
    expect(verify.runs()).toEqual([]);
  });

  test('確かめる対象のホスト名が資源一覧に無ければ、そのキーを示して失敗する', async () => {
    const texts = infisicalRepoTexts();
    const catalog = JSON.parse(
      texts['apps/infra/environments/prod.json'] ?? '{}',
    ) as { hostnames: Record<string, unknown> };
    const hostnames = Object.fromEntries(
      Object.entries(catalog.hostnames).filter(([key]) => key !== 'event'),
    );
    const verify = createVerify({
      texts: {
        ...texts,
        'apps/infra/environments/prod.json': JSON.stringify({
          ...catalog,
          hostnames,
        }),
      },
    });

    const code = await command.run(['--env', 'prod'], verify.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(verify.stderr.text()).toContain('hostnames.event');
    expect(verify.waits()).toEqual([]);
  });
});
