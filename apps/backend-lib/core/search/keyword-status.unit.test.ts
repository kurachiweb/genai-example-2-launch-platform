import { describe, expect, test } from 'bun:test';

import type { KeywordStatus } from './keyword-status.ts';

describe('KeywordStatus', () => {
  test('更新待ち・抽出済み・縮退・非対応言語・無効の5つの状態を持つ', () => {
    const statuses = {
      pending: true,
      extracted: true,
      fallback: true,
      unsupported: true,
      disabled: true,
    } as const satisfies Record<KeywordStatus, true>;

    expect(Object.keys(statuses)).toHaveLength(5);
  });

  test('5つ以外の状態は型検査で拒否される', () => {
    // @ts-expect-error 失敗は状態の値ではない
    const status: KeywordStatus = 'failed';

    expect<string>(status).toBe('failed');
  });
});
