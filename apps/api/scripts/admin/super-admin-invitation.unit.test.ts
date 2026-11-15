import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createKeyedHasher } from '../../lib/core/crypto/keyed-hasher.ts';
import {
  ADMIN_AUTH_TOKEN_TTL_SECONDS,
  ADMIN_HASH_PURPOSES,
} from '../../src/domain/admin/admin-auth-token-purpose.ts';
import { buildInvitationSql, buildLookupSql } from './invitation-sql.ts';
import {
  type InvitationTarget,
  invitationTarget,
} from './invitation-targets.ts';
import {
  type CommandResult,
  createCommandRunner,
  createTempSqlFiles,
  type InvitationDependencies,
  runSuperAdminInvitation,
  withoutPepper,
} from './super-admin-invitation.ts';

const TEST_PEPPER = ['invitation', 'script', 'unit', 'test', 'pepper'].join(
  '-',
);

const NOW = new Date(Date.UTC(2026, 10, 3, 9, 30, 0));

const EXPIRES_AT = new Date(
  NOW.getTime() + ADMIN_AUTH_TOKEN_TTL_SECONDS.invitation * 1000,
);

const EMAIL = 'first-owner@launch.example';

const NEW_ADMIN_ID = '01JBNEWADMIN0000000000000A';

const NEW_TOKEN_ID = '01JBNEWTOKEN0000000000000A';

const INVITED_ADMIN_ID = '01JBINVITEDADMIN0000000000';

const ACTIVE_ADMIN_ID = '01JBACTIVEADMIN00000000000';

const TEMP_SQL_PATH = '/fake-tmp/super-admin-invitation-x/invitation.sql';

const LINK_PATTERN = /^招待のリンク: (\S+)$/mu;

const PLAIN_TOKEN = 'unit-test-invitation-token'.padEnd(43, '_');

interface LookupRow {
  readonly id: string;
  readonly status: string;
}

interface Scenario {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly lookup?: CommandResult;
  readonly write?: CommandResult;
  readonly removeFails?: boolean;
}

const lookupOutput = (rows: readonly LookupRow[]): CommandResult => ({
  exitCode: 0,
  stdout: JSON.stringify([
    { results: rows, success: true, meta: { duration: 0 } },
  ]),
  stderr: '',
});

const WRITE_SUCCEEDED: CommandResult = {
  exitCode: 0,
  stdout: JSON.stringify([{ results: [], success: true, meta: {} }]),
  stderr: '',
};

function createHarness(scenario: Scenario = {}) {
  const timeline: string[] = [];
  const wranglerCalls: (readonly string[])[] = [];
  const writtenSql: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const ids = [NEW_ADMIN_ID, NEW_TOKEN_ID];
  const deps: InvitationDependencies = {
    env: scenario.env ?? { HASH_PEPPER: TEST_PEPPER },
    wrangler: (args) => {
      wranglerCalls.push(args);
      if (args.includes('--command')) {
        timeline.push('lookup');
        return Promise.resolve(scenario.lookup ?? lookupOutput([]));
      }
      timeline.push(`write:${args.at(-1) ?? ''}`);
      return Promise.resolve(scenario.write ?? WRITE_SUCCEEDED);
    },
    tempFiles: {
      write: (sql) => {
        timeline.push('temp-write');
        writtenSql.push(sql);
        return Promise.resolve(TEMP_SQL_PATH);
      },
      remove: (path) => {
        timeline.push(`temp-remove:${path}`);
        return scenario.removeFails === true
          ? Promise.reject(new Error('削除できません'))
          : Promise.resolve();
      },
    },
    secretGenerator: {
      token: () => {
        timeline.push('token');
        return PLAIN_TOKEN;
      },
      randomString: () => {
        throw new Error('招待の発行は文字列の乱数を使いません。');
      },
      uuid: () => {
        throw new Error('招待の発行はUUIDを使いません。');
      },
    },
    now: () => NOW,
    newId: () => {
      const id = ids.shift();
      if (id === undefined) {
        throw new Error('偽のIDを使い切りました。');
      }
      timeline.push(`id:${id}`);
      return id;
    },
    stdout: {
      write: (text) => {
        timeline.push('stdout');
        stdout.push(text);
      },
    },
    stderr: { write: (text) => stderr.push(text) },
  };
  return {
    deps,
    timeline,
    wranglerCalls,
    writtenSql,
    stdoutText: () => stdout.join(''),
    stderrText: () => stderr.join(''),
  };
}

function plainTokenOf(output: string): string {
  const link = LINK_PATTERN.exec(output)?.[1];
  if (link === undefined) {
    throw new Error(`招待のリンクが表示されていません。\n${output}`);
  }
  const url = new URL(link);
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  if (token === null) {
    throw new Error(`リンクにトークンがありません: ${link}`);
  }
  return token;
}

function tokenHashOf(sql: string): string {
  const hash = /'([A-Za-z0-9_-]{86})'/u.exec(sql)?.[1];
  if (hash === undefined) {
    throw new Error(`SQLにトークンのハッシュがありません。\n${sql}`);
  }
  return hash;
}

const lookupArgs = (
  target: InvitationTarget,
  email: string,
): readonly string[] => [
  'd1',
  'execute',
  'DB',
  ...invitationTarget(target).wranglerArgs,
  '--json',
  '--command',
  buildLookupSql(email),
];

describe('runSuperAdminInvitation(引数の検証)', () => {
  test.each([
    [
      '環境の指定が無い',
      ['--email', EMAIL],
      '環境(--target)を指定してください',
    ],
    [
      '環境の値が無い',
      ['--target', '--email', EMAIL],
      '引数が正しくありません',
    ],
    [
      '知らない環境',
      ['--target', 'preview', '--email', EMAIL],
      '環境(--target)はlocal・staging・prodのいずれかを指定してください',
    ],
    [
      'メールアドレスの指定が無い',
      ['--target', 'local'],
      'メールアドレス(--email)を指定してください',
    ],
    [
      'メールアドレスが空白だけ',
      ['--target', 'local', '--email', '  '],
      'メールアドレス(--email)を指定してください',
    ],
    [
      'メールアドレスの形式が正しくない',
      ['--target', 'local', '--email', 'not-an-address'],
      'メールアドレスの形式が正しくありません',
    ],
    [
      'メールアドレスが254文字を超える',
      ['--target', 'local', '--email', `${'a'.repeat(243)}@launch.example`],
      'メールアドレスは254文字以内で指定してください',
    ],
    [
      '知らないオプション',
      ['--target', 'local', '--email', EMAIL, '--role', 'viewer'],
      '引数が正しくありません',
    ],
    [
      '位置引数',
      ['--target', 'local', '--email', EMAIL, 'extra'],
      '引数が正しくありません',
    ],
  ])('%sなら何もせずに理由を表示して失敗する', async (_label, argv, reason) => {
    const harness = createHarness();

    const exitCode = await runSuperAdminInvitation(argv, harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.stderrText()).toContain(reason);
    expect(harness.stderrText()).toContain('使い方:');
    expect(harness.timeline).toEqual([]);
  });

  test.each([
    ['注入されていない', {}],
    ['空の', { HASH_PEPPER: '' }],
  ])(
    'ペッパーが%s場合は照会せずに、Infisicalの注入付きの実行方法を表示して失敗する',
    async (_label, env) => {
      const harness = createHarness({ env });

      const exitCode = await runSuperAdminInvitation(
        ['--target', 'staging', '--email', EMAIL],
        harness.deps,
      );

      expect(exitCode).toBe(1);
      expect(harness.stderrText()).toContain('HASH_PEPPERが注入されていません');
      expect(harness.stderrText()).toContain(
        'infisical --telemetry=false run --env staging -- bun run admin:invite-super-admin -- --target staging --email <メールアドレス>',
      );
      expect(harness.timeline).toEqual([]);
    },
  );

  test('メールアドレスの前後の空白を除いて照会する', async () => {
    const harness = createHarness();

    await runSuperAdminInvitation(
      ['--target', 'local', `--email=\u3000${EMAIL} `],
      harness.deps,
    );

    expect(harness.wranglerCalls[0]).toEqual(lookupArgs('local', EMAIL));
  });
});

describe('runSuperAdminInvitation(照会と失敗)', () => {
  test('有効な管理者のアドレスなら何も書き込まずに失敗する', async () => {
    const harness = createHarness({
      lookup: lookupOutput([{ id: ACTIVE_ADMIN_ID, status: 'active' }]),
    });

    const exitCode = await runSuperAdminInvitation(
      ['--target', 'local', '--email', EMAIL],
      harness.deps,
    );

    expect(exitCode).toBe(1);
    expect(harness.stderrText()).toContain(
      '既に有効な管理者がいるメールアドレスです',
    );
    expect(harness.timeline).toEqual(['lookup']);
    expect(harness.stdoutText()).toBe('');
  });

  test.each([
    [
      'Wranglerが失敗した',
      {
        exitCode: 1,
        stdout: JSON.stringify({ error: { text: 'no such table: admins' } }),
        stderr: '',
      },
      'no such table: admins',
    ],
    [
      '出力がJSONでない',
      { exitCode: 0, stdout: 'not json', stderr: '' },
      '照会の結果の形式が正しくありません',
    ],
    [
      '知らない状態の管理者が返った',
      lookupOutput([{ id: ACTIVE_ADMIN_ID, status: 'suspended' }]),
      '照会の結果の形式が正しくありません',
    ],
    [
      '複数の管理者が返った',
      lookupOutput([
        { id: INVITED_ADMIN_ID, status: 'invited' },
        { id: ACTIVE_ADMIN_ID, status: 'invited' },
      ]),
      '照会の結果の形式が正しくありません',
    ],
  ])(
    '照会で%s場合は何も書き込まずに失敗する',
    async (_label, lookup, reason) => {
      const harness = createHarness({ lookup });

      const exitCode = await runSuperAdminInvitation(
        ['--target', 'local', '--email', EMAIL],
        harness.deps,
      );

      expect(exitCode).toBe(1);
      expect(harness.stderrText()).toContain('管理者を照会できませんでした');
      expect(harness.stderrText()).toContain(reason);
      expect(harness.timeline).toEqual(['lookup']);
    },
  );
});

describe('runSuperAdminInvitation(発行)', () => {
  test('管理者がいなければ、照会→IDとトークンの生成→一時ファイルでの書き込み→削除→表示の順に処理する', async () => {
    const harness = createHarness();

    const exitCode = await runSuperAdminInvitation(
      ['--target', 'local', '--email', EMAIL],
      harness.deps,
    );

    expect(exitCode).toBe(0);
    expect(harness.timeline).toEqual([
      'lookup',
      `id:${NEW_ADMIN_ID}`,
      `id:${NEW_TOKEN_ID}`,
      'token',
      'temp-write',
      `write:${TEMP_SQL_PATH}`,
      `temp-remove:${TEMP_SQL_PATH}`,
      'stdout',
    ]);
    expect(harness.wranglerCalls[1]).toEqual([
      'd1',
      'execute',
      'DB',
      ...invitationTarget('local').wranglerArgs,
      '--json',
      '--yes',
      '--file',
      TEMP_SQL_PATH,
    ]);
  });

  test('管理者がいなければ、最上位管理者ロールの招待中の管理者と、ハッシュだけのトークンを書き込むSQLにする', async () => {
    const harness = createHarness();

    await runSuperAdminInvitation(
      ['--target', 'local', '--email', EMAIL],
      harness.deps,
    );

    const [sql = ''] = harness.writtenSql;
    const plain = plainTokenOf(harness.stdoutText());
    const tokenHash = tokenHashOf(sql);
    expect(sql).toBe(
      buildInvitationSql({
        existingInvitedAdminId: undefined,
        newAdminId: NEW_ADMIN_ID,
        email: EMAIL,
        tokenId: NEW_TOKEN_ID,
        tokenHash,
        now: NOW,
        expiresAt: EXPIRES_AT,
      }),
    );
    expect(sql).not.toContain(plain);
  });

  test('招待中の管理者のアドレスなら、その管理者を最上位管理者にして招待をやり直すSQLにする', async () => {
    const harness = createHarness({
      lookup: lookupOutput([{ id: INVITED_ADMIN_ID, status: 'invited' }]),
    });

    const exitCode = await runSuperAdminInvitation(
      ['--target', 'local', '--email', EMAIL],
      harness.deps,
    );

    const [sql = ''] = harness.writtenSql;
    expect(exitCode).toBe(0);
    expect(sql).toBe(
      buildInvitationSql({
        existingInvitedAdminId: INVITED_ADMIN_ID,
        newAdminId: NEW_ADMIN_ID,
        email: EMAIL,
        tokenId: NEW_TOKEN_ID,
        tokenHash: tokenHashOf(sql),
        now: NOW,
        expiresAt: EXPIRES_AT,
      }),
    );
    expect(harness.stdoutText()).toContain(
      '招待中の管理者を最上位管理者にし、未使用の招待のリンクを無効にしました',
    );
  });

  test('トークンのハッシュは、アプリが招待のリンクを照合する用途とペッパーのハッシュと一致する', async () => {
    const harness = createHarness();

    await runSuperAdminInvitation(
      ['--target', 'local', '--email', EMAIL],
      harness.deps,
    );

    const plain = plainTokenOf(harness.stdoutText());
    const hasher = createKeyedHasher(TEST_PEPPER);
    expect(plain).toBe(PLAIN_TOKEN);
    expect(tokenHashOf(harness.writtenSql[0] ?? '')).toBe(
      await hasher.hash(ADMIN_HASH_PURPOSES.authToken('invitation'), plain),
    );
  });

  test.each<[InvitationTarget, string]>([
    ['local', 'http://localhost:48045'],
    ['staging', 'https://genai-example-2-admin-staging.lab.kurachiweb.com'],
    ['prod', 'https://genai-example-2-admin.lab.kurachiweb.com'],
  ])(
    '%sでは管理者側のオリジンの招待の画面へ、トークンをフラグメントに置いたリンクと有効期限を表示し、メールを送らない旨を示す',
    async (target, origin) => {
      const harness = createHarness();

      await runSuperAdminInvitation(
        ['--target', target, '--email', EMAIL],
        harness.deps,
      );

      const output = harness.stdoutText();
      const plain = plainTokenOf(output);
      expect(LINK_PATTERN.exec(output)?.[1]).toBe(
        `${origin}/auth/invitation#token=${plain}`,
      );
      expect(output).toContain(
        `有効期限: 2026年11月4日09:30(UTC) [${EXPIRES_AT.toISOString()}]`,
      );
      expect(output).toContain('招待のメールは送っていません');
      expect(harness.stderrText()).toBe('');
      expect(harness.wranglerCalls[0]).toEqual(lookupArgs(target, EMAIL));
    },
  );

  test('書き込みに失敗したら、一時ファイルを消し、リンクを表示せずに失敗する', async () => {
    const harness = createHarness({
      write: {
        exitCode: 1,
        stdout: JSON.stringify({
          error: { text: 'NOT NULL constraint failed: admin_auth_tokens' },
        }),
        stderr: '',
      },
    });

    const exitCode = await runSuperAdminInvitation(
      ['--target', 'local', '--email', EMAIL],
      harness.deps,
    );

    expect(exitCode).toBe(1);
    expect(harness.timeline.at(-1)).toBe(`temp-remove:${TEMP_SQL_PATH}`);
    expect(harness.stderrText()).toContain('招待を書き込めませんでした');
    expect(harness.stderrText()).toContain('NOT NULL constraint failed');
    expect(harness.stdoutText()).toBe('');
  });

  test('一時ファイルを消せなければ、場所を示し、リンクを表示せずに失敗する', async () => {
    const harness = createHarness({ removeFails: true });

    const exitCode = await runSuperAdminInvitation(
      ['--target', 'local', '--email', EMAIL],
      harness.deps,
    );

    expect(exitCode).toBe(1);
    expect(harness.stderrText()).toContain(
      `一時ファイルを削除できませんでした: ${TEMP_SQL_PATH}`,
    );
    expect(harness.stdoutText()).toBe('');
  });
});

describe('createTempSqlFiles', () => {
  test('本人だけが読める一時ファイルにSQLを書き、削除でディレクトリごと消す', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'invitation-temp-test-'));
    try {
      const files = createTempSqlFiles(baseDir);

      const path = await files.write('SELECT 1;\n');

      expect(await readFile(path, 'utf8')).toBe('SELECT 1;\n');
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(dirname(dirname(path))).toBe(baseDir);

      await files.remove(path);

      expect(existsSync(dirname(path))).toBe(false);
      expect(readdirSync(baseDir)).toEqual([]);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe('createCommandRunner', () => {
  test('シェルを介さずに起動し、終了コードと標準出力と標準エラー出力を返す', async () => {
    const run = createCommandRunner({
      bin: process.execPath,
      cwd: tmpdir(),
      env: { PATH: '/usr/bin:/bin' },
    });

    const result = await run([
      '-e',
      'process.stdout.write(process.argv[1] ?? ""); process.stderr.write(String(process.env.HASH_PEPPER)); process.exit(3)',
      "'; echo injected",
    ]);

    expect(result).toEqual({
      exitCode: 3,
      stdout: "'; echo injected",
      stderr: 'undefined',
    });
  });
});

describe('withoutPepper', () => {
  test('子のプロセスへ渡す環境変数からペッパーだけを除く', () => {
    expect(
      withoutPepper({
        HASH_PEPPER: TEST_PEPPER,
        PATH: '/usr/bin',
        CLOUDFLARE_ACCOUNT_ID: undefined,
      }),
    ).toEqual({ PATH: '/usr/bin', CLOUDFLARE_ACCOUNT_ID: undefined });
  });
});
