import { describe, expect, test } from 'bun:test';

import {
  isTransientD1Error,
  TRANSIENT_D1_RETRY_DELAYS_MS,
  withTransientRetry,
} from './transient-retry.ts';

const lockedError = (): Error =>
  new Error(
    'D1_ERROR: NOSENTRY database is locked: SQLITE_BUSY (extended: SQLITE_BUSY_SNAPSHOT)',
  );

const localInternalError = (): Error =>
  new Error(
    'D1_ERROR: Failed to parse body as JSON, got: Error: internal error; reference = 6elk1tu2cdp6o88to80karpf',
  );

describe('isTransientD1Error', () => {
  test.each([
    ['ロックの競合(SQLITE_BUSY)', lockedError()],
    [
      'ローカルのD1がロックの競合を内部エラーとして返した失敗',
      localInternalError(),
    ],
    [
      '原因の連鎖にあるロックの競合',
      new Error('Failed query', { cause: lockedError() }),
    ],
  ])('%sを一時的な失敗と判定する', (_label, error) => {
    expect(isTransientD1Error(error)).toBe(true);
  });

  test.each([
    ['制約の違反', new Error('D1_ERROR: UNIQUE constraint failed: t.id')],
    [
      '書き込みの成否が分からない内部エラー',
      new Error('D1_ERROR: internal error; reference = abc'),
    ],
    ['D1と関係の無い失敗', new TypeError('処理に失敗しました')],
    ['Errorでない値', 'SQLITE_BUSY'],
  ])('%sは一時的な失敗と判定しない', (_label, error) => {
    expect(isTransientD1Error(error)).toBe(false);
  });

  test('原因の連鎖が循環していても判定を終える', () => {
    const error = new Error('外側');
    (error as { cause?: unknown }).cause = error;

    expect(isTransientD1Error(error)).toBe(false);
  });
});

interface FakeStatement extends D1PreparedStatement {
  readonly sql: string;
  readonly values: readonly unknown[];
}

// 呼び出しごとに、決めた回数だけ失敗させてから成功する偽のD1
function createFakeD1(failures: Readonly<Record<string, number>>) {
  const calls: string[] = [];
  const remaining = new Map(Object.entries(failures));
  const attempt = <T>(name: string, value: T): Promise<T> => {
    calls.push(name);
    const left = remaining.get(name) ?? 0;
    if (left > 0) {
      remaining.set(name, left - 1);
      return Promise.reject(lockedError());
    }
    return Promise.resolve(value);
  };
  const statementOf = (
    sql: string,
    values: readonly unknown[],
  ): FakeStatement =>
    ({
      sql,
      values,
      bind: (...next: unknown[]) => statementOf(sql, next),
      first: () => attempt(`first:${sql}`, { value: 1 }),
      run: () =>
        attempt(`run:${sql}`, { success: true, meta: {}, results: [] }),
      all: () =>
        attempt(`all:${sql}`, { success: true, meta: {}, results: [] }),
      raw: () => attempt(`raw:${sql}`, [[1]]),
    }) as unknown as FakeStatement;
  const batched: (readonly FakeStatement[])[] = [];
  const d1 = {
    prepare: (sql: string) => statementOf(sql, []),
    batch: (statements: readonly FakeStatement[]) => {
      batched.push(statements);
      return attempt(
        'batch',
        statements.map(() => ({ success: true })),
      );
    },
    exec: (sql: string) => attempt(`exec:${sql}`, { count: 1, duration: 0 }),
  } as unknown as D1Database;
  return { d1, calls, batched };
}

const recordWaits = () => {
  const waits: number[] = [];
  return {
    waits,
    sleep: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
};

describe('withTransientRetry', () => {
  test.each(['first', 'run', 'all', 'raw'] as const)(
    '値を結び付けた文の%sは、ロックの競合の後に同じ値でやり直す',
    async (method) => {
      const { d1, calls } = createFakeD1({ [`${method}:select ?`]: 2 });
      const { waits, sleep } = recordWaits();

      const statement = withTransientRetry(d1, { sleep })
        .prepare('select ?')
        .bind(7);
      const run: Record<typeof method, () => Promise<unknown>> = {
        first: () => statement.first(),
        run: () => statement.run(),
        all: () => statement.all(),
        raw: () => statement.raw(),
      };
      await run[method]();

      expect(calls).toEqual(
        Array.from({ length: 3 }, () => `${method}:select ?`),
      );
      expect(waits).toEqual(TRANSIENT_D1_RETRY_DELAYS_MS.slice(0, 2));
    },
  );

  test('一括の書き込みは、元の文を渡してロックの競合の後に一括ごとやり直す', async () => {
    const { d1, calls, batched } = createFakeD1({ batch: 1 });
    const db = withTransientRetry(d1, recordWaits());

    await db.batch([
      db.prepare('insert a').bind(1),
      db.prepare('insert b').bind(2),
    ]);

    expect(calls).toEqual(['batch', 'batch']);
    expect(
      batched.map((statements) =>
        statements.map(({ sql, values }) => [sql, values]),
      ),
    ).toEqual([
      [
        ['insert a', [1]],
        ['insert b', [2]],
      ],
      [
        ['insert a', [1]],
        ['insert b', [2]],
      ],
    ]);
  });

  test('ロックの競合が続けば、決めた回数だけやり直して最後の失敗を投げ、やり直しを知らせる', async () => {
    const { d1, calls } = createFakeD1({ 'run:update t': 10 });
    const { waits, sleep } = recordWaits();
    const retried: number[] = [];

    const failure = await withTransientRetry(d1, {
      sleep,
      onRetry: (_error, delayMs) => retried.push(delayMs),
    })
      .prepare('update t')
      .run()
      .catch((error: unknown) => error);

    expect(isTransientD1Error(failure)).toBe(true);
    expect(calls).toHaveLength(TRANSIENT_D1_RETRY_DELAYS_MS.length + 1);
    expect(waits).toEqual([...TRANSIENT_D1_RETRY_DELAYS_MS]);
    expect(retried).toEqual([...TRANSIENT_D1_RETRY_DELAYS_MS]);
  });

  test('一時的でない失敗はやり直さずにそのまま投げる', async () => {
    const failure = new Error('D1_ERROR: UNIQUE constraint failed: t.id');
    const d1 = {
      prepare: () => ({
        bind() {
          return this;
        },
        run: () => Promise.reject(failure),
      }),
    } as unknown as D1Database;
    const { waits, sleep } = recordWaits();

    const thrown = await withTransientRetry(d1, { sleep })
      .prepare('insert t')
      .run()
      .catch((error: unknown) => error);

    expect(thrown).toBe(failure);
    expect(waits).toEqual([]);
  });

  test('execもロックの競合の後にやり直す', async () => {
    const { d1, calls } = createFakeD1({ 'exec:vacuum': 1 });

    await withTransientRetry(d1, recordWaits()).exec('vacuum');

    expect(calls).toEqual(['exec:vacuum', 'exec:vacuum']);
  });
});
