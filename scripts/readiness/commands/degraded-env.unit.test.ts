import { describe, expect, test } from 'bun:test';

import {
  type DegradationRow,
  DEGRADATION_MATRIX,
  EXTERNAL_SERVICES,
} from '../core/degraded-overrides.ts';
import { createDegradedEnvCommand } from './degraded-env.ts';
import { EXIT_SUCCESS, UsageError } from './shared/readiness-command.ts';

interface Harness {
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly execute: (args: readonly string[]) => Promise<number>;
}

const setup = (
  matrix: readonly DegradationRow[] = DEGRADATION_MATRIX,
): Harness => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const { run } = createDegradedEnvCommand({ matrix });
  return {
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
    execute: (args) =>
      run(args, {
        stdout: { write: (text) => stdout.push(text) },
        stderr: { write: (text) => stderr.push(text) },
      }),
  };
};

const rowOf = (overrides: Partial<DegradationRow>): DegradationRow => ({
  service: 'stripe',
  failure: 'timeout',
  expected: '期待する振る舞い',
  evidence: ['apps/api/package.json'],
  notifiesOperator: true,
  owner: 'payments',
  ...overrides,
});

describe('degraded-env', () => {
  test('引数が無ければ全サービスを止める起動のコマンドを、Workerごとに表示して成功する', async () => {
    const harness = setup();

    const code = await harness.execute([]);

    expect(code).toBe(EXIT_SUCCESS);
    const out = harness.stdout();
    expect(out).toContain('--worker api --');
    expect(out).toContain('--worker event --');
    expect(out).toContain(
      'E2E_DEGRADED_SERVICES=rekognition,gcp-nl,stripe,email,disify',
    );
    expect(harness.stderr()).toBe('');
  });

  test('`all`は引数が無い場合と同じ表示にする', async () => {
    const empty = setup();
    const all = setup();
    await empty.execute([]);
    await all.execute(['all']);

    expect(all.stdout()).toBe(empty.stdout());
  });

  test('指定したサービスの差し替えだけを表示する', async () => {
    const harness = setup();

    await harness.execute(['email']);

    const out = harness.stdout();
    expect(out).toContain('MAILPIT_API_URL:http://127.0.0.1:1');
    expect(out).not.toContain('--worker api --');
    expect(out).not.toContain('STRIPE_API_KEY');
    expect(out).toContain('E2E_DEGRADED_SERVICES=email');
  });

  test('サービスの指定は順序と重複によらず、同じ表示にする', async () => {
    const left = setup();
    const right = setup();
    await left.execute(['email', 'stripe', 'email']);
    await right.execute(['stripe', 'email']);

    expect(left.stdout()).toBe(right.stdout());
  });

  test('差し替えの手段が無いHIBPは、コマンドを出さず対応表だけである旨を示す', async () => {
    const harness = setup();

    const code = await harness.execute(['hibp']);

    expect(code).toBe(EXIT_SUCCESS);
    const out = harness.stdout();
    expect(out).toContain('hibp');
    expect(out).toContain('差し替えの手段が無いサービス: hibp');
    expect(out).not.toContain('run-with-secrets');
    expect(out).not.toContain('E2E_DEGRADED_SERVICES=');
  });

  test('全サービスの指定でも、HIBPを差し替えの手段が無いサービスとして挙げる', async () => {
    const harness = setup();

    await harness.execute([]);

    expect(harness.stdout()).toContain('差し替えの手段が無いサービス: hibp');
  });

  test('表示に秘密の値の形が含まれない', async () => {
    const harness = setup();

    await harness.execute(['--matrix']);

    expect(harness.stdout()).not.toMatch(
      /rk_(?:test|live)_|sk_(?:test|live)_|whsec_|AKIA/u,
    );
  });

  test('全ての行に証跡がある対応表では、証跡の無い行は無い旨を示す', async () => {
    const harness = setup();

    await harness.execute([]);

    expect(harness.stdout()).toContain('証跡の無い行(指摘の候補): なし');
  });

  test('証跡の無い行は、サービス・障害の種類・担当specを付けて指摘の候補に挙げる', async () => {
    const harness = setup([
      rowOf({
        service: 'stripe',
        failure: 'auth',
        evidence: [],
        owner: 'payments',
      }),
      rowOf({ service: 'email', failure: 'quota' }),
    ]);

    const code = await harness.execute([]);

    expect(code).toBe(EXIT_SUCCESS);
    const out = harness.stdout();
    expect(out).toContain('証跡の無い行(指摘の候補): 1件');
    expect(out).toContain('- stripe/auth(担当spec: payments)');
    expect(out).not.toContain('- email/quota');
  });

  test('運用者へ通知されない行を、要件6.5の確認の候補として挙げる', async () => {
    const harness = setup([
      rowOf({ service: 'stripe', failure: 'auth', notifiesOperator: false }),
      rowOf({ service: 'email', failure: 'quota', notifiesOperator: true }),
    ]);

    await harness.execute([]);

    const out = harness.stdout();
    expect(out).toContain('運用者へ通知されない行(要件6.5の確認): 1件');
    expect(out).toContain('- stripe/auth(担当spec: payments)');
  });

  test('`--matrix`は対応表を、全行を含むマークダウンの表で表示する', async () => {
    const harness = setup();

    const code = await harness.execute(['--matrix']);

    expect(code).toBe(EXIT_SUCCESS);
    const lines = harness.stdout().split('\n');
    const header = lines.findIndex((line) => line.startsWith('| サービス |'));
    expect(header).toBeGreaterThanOrEqual(0);
    const rows = lines
      .slice(header + 2)
      .filter((line) => line.startsWith('| '));
    expect(rows).toHaveLength(DEGRADATION_MATRIX.length);
    for (const service of EXTERNAL_SERVICES) {
      expect(rows.some((row) => row.startsWith(`| ${service} |`))).toBe(true);
    }
  });

  test('表のセルの中の縦線は列の区切りにならないよう逃がす', async () => {
    const harness = setup([
      rowOf({ expected: '甲|乙', evidence: ['a|b.unit.test.ts'] }),
    ]);

    await harness.execute(['--matrix']);

    const row = harness
      .stdout()
      .split('\n')
      .find((line) => line.startsWith('| stripe |'));
    expect(row?.replaceAll('\\|', '').split('|')).toHaveLength(8);
  });

  test('未知のサービス名は、一覧を示す使い方の誤りにする', async () => {
    const harness = setup();

    const error: unknown = await harness
      .execute(['stripes'])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('stripes');
    expect((error as Error).message).toContain('rekognition');
  });

  test('未知のオプションは使い方の誤りにする', async () => {
    const harness = setup();

    const error: unknown = await harness
      .execute(['--unknown'])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
  });

  test('実際の起動はせず、表示だけで終わる', async () => {
    const harness = setup();

    await harness.execute([]);

    expect(harness.stdout()).toContain('起動はしません');
  });

  describe('--help', () => {
    test.each(['--help', '-h'])(
      '%sは使い方だけを標準出力へ出して成功し、起動の差し替えも対応表も表示しない',
      async (flag) => {
        const harness = setup();

        const code = await harness.execute([flag]);

        expect(code).toBe(EXIT_SUCCESS);
        expect(harness.stderr()).toBe('');
        const out = harness.stdout();
        expect(out).toContain('使い方: degraded-env');
        expect(out).not.toContain('起動はしません');
        expect(out).not.toContain('| サービス |');
        expect(out).not.toContain('証跡の無い行(指摘の候補)');
      },
    );

    test('サービスや他のオプションと並べても使い方だけを表示する', async () => {
      const harness = setup();

      const code = await harness.execute(['email', '--matrix', '--help']);

      expect(code).toBe(EXIT_SUCCESS);
      expect(harness.stdout()).toContain('使い方: degraded-env');
      expect(harness.stdout()).not.toContain('起動はしません');
    });

    test('全てのサービスとオプションと終了コードの意味を示す', async () => {
      const harness = setup();

      await harness.execute(['--help']);

      const out = harness.stdout();
      for (const service of EXTERNAL_SERVICES) {
        expect(out).toContain(service);
      }
      expect(out).toContain('all');
      expect(out).toContain('--matrix');
      expect(out).toContain('終了コード0');
      expect(out).toContain('終了コード2');
    });
  });
});
