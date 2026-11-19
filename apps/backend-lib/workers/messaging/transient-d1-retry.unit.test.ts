import { describe, expect, test } from 'bun:test';

import {
  isTransientD1Error,
  retryTransientD1,
  TRANSIENT_D1_RETRY_DELAYS_MS,
} from './transient-d1-retry.ts';

const lockedError = (): Error =>
  new Error('Failed query: select "id" from "t"', {
    cause: new Error(
      'D1_ERROR: NOSENTRY database is locked: SQLITE_BUSY (extended: SQLITE_BUSY_SNAPSHOT)',
    ),
  });

const internalError = (): Error =>
  new Error('Failed query: update "t" set "a" = ?', {
    cause: new Error(
      'D1_ERROR: Failed to parse body as JSON, got: Error: internal error; reference = 6elk1tu2cdp6o88to80karpf',
    ),
  });

describe('isTransientD1Error', () => {
  test.each([
    ['原因の連鎖にロックの競合(SQLITE_BUSY)がある失敗', lockedError()],
    ['原因の連鎖にD1の内部エラーがある失敗', internalError()],
    [
      '直接のロックの競合',
      new Error('D1_ERROR: database is locked: SQLITE_BUSY'),
    ],
  ])('%sを一時的な失敗と判定する', (_label, error) => {
    expect(isTransientD1Error(error)).toBe(true);
  });

  test.each([
    ['制約の違反', new Error('D1_ERROR: UNIQUE constraint failed: t.id')],
    ['D1と関係の無い失敗', new TypeError('処理に失敗しました')],
    ['Errorでない値', 'SQLITE_BUSY'],
    ['undefined', undefined],
  ])('%sは一時的な失敗と判定しない', (_label, error) => {
    expect(isTransientD1Error(error)).toBe(false);
  });

  test('原因の連鎖が循環していても判定を終える', () => {
    const error = new Error('外側');
    (error as { cause?: unknown }).cause = error;

    expect(isTransientD1Error(error)).toBe(false);
  });
});

describe('retryTransientD1', () => {
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

  test('一時的な失敗のあとに成功すれば、待ってからやり直した結果を返す', async () => {
    const { waits, sleep } = recordWaits();
    let calls = 0;

    const result = await retryTransientD1(() => {
      calls += 1;
      return calls < 3 ? Promise.reject(lockedError()) : Promise.resolve('ok');
    }, sleep);

    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(waits).toEqual(TRANSIENT_D1_RETRY_DELAYS_MS.slice(0, 2));
  });

  test('一時的な失敗が続けば、決めた回数だけやり直して最後の失敗を投げる', async () => {
    const { waits, sleep } = recordWaits();
    const errors: Error[] = [];

    const run = retryTransientD1(() => {
      const error = lockedError();
      errors.push(error);
      return Promise.reject(error);
    }, sleep);

    expect(await run.catch((error: unknown) => error)).toBe(errors.at(-1));
    expect(errors).toHaveLength(TRANSIENT_D1_RETRY_DELAYS_MS.length + 1);
    expect(waits).toEqual([...TRANSIENT_D1_RETRY_DELAYS_MS]);
  });

  test('一時的でない失敗はやり直さずにそのまま投げる', async () => {
    const { waits, sleep } = recordWaits();
    const failure = new TypeError('処理に失敗しました');
    let calls = 0;

    const run = retryTransientD1(() => {
      calls += 1;
      return Promise.reject(failure);
    }, sleep);

    expect(await run.catch((error: unknown) => error)).toBe(failure);
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });
});
