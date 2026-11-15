import { describe, expect, test } from 'bun:test';

import {
  isLocalD1LockConflict,
  LOCAL_D1_LOCK_CONFLICT_MAX_ATTEMPTS,
  LOCAL_D1_LOCK_CONFLICT_RETRY_DELAY_MS,
  localD1ExecuteArgs,
  parseLocalD1Output,
  retryOnLocalD1LockConflict,
} from './local-d1-command.ts';

const SELECT_SQL = "SELECT id FROM admins WHERE email = 'e2e@test.example';";

describe('localD1ExecuteArgs', () => {
  test('ローカルのD1を共有のローカル状態の保存先で操作し、結果をJSONで出力する引数を返す', () => {
    expect(localD1ExecuteArgs(SELECT_SQL)).toStrictEqual([
      'd1',
      'execute',
      'DB',
      '--local',
      '--persist-to',
      '/workspace/.wrangler/state',
      '--json',
      '--command',
      SELECT_SQL,
    ]);
  });

  test('リモートのD1を操作する引数を含まない', () => {
    expect(localD1ExecuteArgs(SELECT_SQL)).not.toContain('--remote');
  });
});

describe('parseLocalD1Output', () => {
  test('1つの文の結果の行を返す', () => {
    const stdout = JSON.stringify([
      { results: [{ id: 'A1' }, { id: 'A2' }], success: true, meta: {} },
    ]);

    expect(parseLocalD1Output(stdout)).toStrictEqual([
      { id: 'A1' },
      { id: 'A2' },
    ]);
  });

  test('複数の文の結果の行を、文の順に並べて返す', () => {
    const stdout = JSON.stringify([
      { results: [], success: true, meta: {} },
      { results: [{ id: 'B1' }], success: true, meta: {} },
    ]);

    expect(parseLocalD1Output(stdout)).toStrictEqual([{ id: 'B1' }]);
  });

  test('行を返さない文だけなら空の配列を返す', () => {
    expect(
      parseLocalD1Output(JSON.stringify([{ results: [], success: true }])),
    ).toStrictEqual([]);
  });

  test.each([
    ['JSONでない', 'エラーが発生しました'],
    ['配列でない', JSON.stringify({ results: [] })],
    ['結果の行が配列でない', JSON.stringify([{ results: 'x' }])],
    ['行がオブジェクトでない', JSON.stringify([{ results: [1] }])],
    ['文の結果がオブジェクトでない', JSON.stringify(['x'])],
  ])('出力が%s場合は、出力を示して失敗する', (_label, stdout) => {
    expect(() => parseLocalD1Output(stdout)).toThrow(
      `ローカルのD1の実行結果の形式が正しくありません: ${stdout}`,
    );
  });
});

const BUSY_STDOUT = JSON.stringify({
  error: { text: 'NOSENTRY database is locked: SQLITE_BUSY' },
});

const failure = (output: string): Error =>
  new Error(`ローカルのD1でSQLを実行できませんでした。\n${output}`);

const BUSY_FAILURE = failure(BUSY_STDOUT);

const READONLY_FAILURE = failure(
  JSON.stringify({
    error: { text: 'attempt to write a readonly database: SQLITE_READONLY' },
  }),
);

const OTHER_FAILURE = failure(
  JSON.stringify({ error: { text: 'no such table: missing: SQLITE_ERROR' } }),
);

interface RecordedRun {
  readonly result: Promise<string>;
  readonly attempts: () => number;
  readonly waits: readonly number[];
}

const runWithOutcomes = (
  outcomes: readonly (string | Error)[],
): RecordedRun => {
  let attempts = 0;
  const waits: number[] = [];
  const result = retryOnLocalD1LockConflict(
    () => {
      const outcome = outcomes[attempts] ?? new Error('想定より多く実行した');
      attempts += 1;
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    },
    (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    },
  );
  return { result, attempts: () => attempts, waits };
};

describe('isLocalD1LockConflict', () => {
  test.each([
    ['標準出力の失敗の文', BUSY_FAILURE],
    [
      '標準エラーの拡張のコード付きの失敗の文',
      failure(
        [
          JSON.stringify({
            error: { text: 'internal error; reference = abcdef0123456789' },
          }),
          'workerd/util/sqlite.c++:852: failed: SENTRY_DO SQLite failed; NOSENTRY database is locked: SQLITE_BUSY (extended: SQLITE_BUSY_RECOVERY)',
        ].join('\n'),
      ),
    ],
    [
      '実行環境の起動の失敗の文',
      failure(
        JSON.stringify({
          error: {
            text: 'The Workers runtime failed to start.\n*** Fatal uncaught kj::Exception: NOSENTRY database is locked: SQLITE_BUSY (extended: SQLITE_BUSY_RECOVERY)',
          },
        }),
      ),
    ],
    ['読み取り専用として書き込みを拒まれた失敗の文', READONLY_FAILURE],
  ])(
    'ロックの競合で取り消されたことを示す%sを含む失敗ならtrueを返す',
    (_label, error) => {
      expect(isLocalD1LockConflict(error)).toBe(true);
    },
  );

  test.each([
    ['ロックの競合以外のSQLの失敗', OTHER_FAILURE],
    ['Errorでない値', 'database is locked: SQLITE_BUSY'],
    ['undefined', undefined],
  ])('%sならfalseを返す', (_label, error) => {
    expect(isLocalD1LockConflict(error)).toBe(false);
  });
});

describe('retryOnLocalD1LockConflict', () => {
  test('最初の実行が成功すれば待たずにその結果を返す', async () => {
    const run = runWithOutcomes(['結果']);

    expect(await run.result).toBe('結果');
    expect(run.attempts()).toBe(1);
    expect(run.waits).toStrictEqual([]);
  });

  test('ロックの競合で失敗した間は、決まった時間を待って実行し直し、成功した結果を返す', async () => {
    const run = runWithOutcomes([BUSY_FAILURE, READONLY_FAILURE, '結果']);

    expect(await run.result).toBe('結果');
    expect(run.attempts()).toBe(3);
    expect(run.waits).toStrictEqual([
      LOCAL_D1_LOCK_CONFLICT_RETRY_DELAY_MS,
      LOCAL_D1_LOCK_CONFLICT_RETRY_DELAY_MS,
    ]);
  });

  test('最大の回数までロックの競合で失敗し続ければ、最後の失敗をそのまま投げる', async () => {
    const lastFailure = failure(BUSY_STDOUT);
    const run = runWithOutcomes([
      ...Array.from(
        { length: LOCAL_D1_LOCK_CONFLICT_MAX_ATTEMPTS - 1 },
        () => BUSY_FAILURE,
      ),
      lastFailure,
      '結果',
    ]);

    expect(await run.result.catch((e: unknown) => e)).toBe(lastFailure);
    expect(run.attempts()).toBe(LOCAL_D1_LOCK_CONFLICT_MAX_ATTEMPTS);
    expect(run.waits).toHaveLength(LOCAL_D1_LOCK_CONFLICT_MAX_ATTEMPTS - 1);
  });

  test('ロックの競合以外の失敗は実行し直さずにそのまま投げる', async () => {
    const run = runWithOutcomes([OTHER_FAILURE, '結果']);

    expect(await run.result.catch((e: unknown) => e)).toBe(OTHER_FAILURE);
    expect(run.attempts()).toBe(1);
    expect(run.waits).toStrictEqual([]);
  });

  test('実行し直した後のロックの競合以外の失敗は、それ以上実行し直さずにそのまま投げる', async () => {
    const run = runWithOutcomes([BUSY_FAILURE, OTHER_FAILURE, '結果']);

    expect(await run.result.catch((e: unknown) => e)).toBe(OTHER_FAILURE);
    expect(run.attempts()).toBe(2);
    expect(run.waits).toStrictEqual([LOCAL_D1_LOCK_CONFLICT_RETRY_DELAY_MS]);
  });

  test('実行し直す間の待ちの合計は、テストの時間切れより十分短い', () => {
    expect(
      (LOCAL_D1_LOCK_CONFLICT_MAX_ATTEMPTS - 1) *
        LOCAL_D1_LOCK_CONFLICT_RETRY_DELAY_MS,
    ).toBeLessThanOrEqual(2_000);
  });
});
