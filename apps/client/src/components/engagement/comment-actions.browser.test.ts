import { describe, expect, test, vi } from 'vitest';

import { COMMENT_ACTIONS } from '../../composition/comment-actions.ts';

// 実行の関数はサーバー専用の処理を読み込むため、登録箇所の部品を読み込むテストでは差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const ACTION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

describe('他者のコメントの操作の登録箇所', () => {
  test('初版では空である', () => {
    expect(COMMENT_ACTIONS).toStrictEqual([]);
  });

  test('idは重複せず`<spec名>.<名詞句>`の形で、orderは有限の数である', () => {
    const ids = COMMENT_ACTIONS.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => ACTION_ID_PATTERN.test(id))).toBe(true);
    expect(COMMENT_ACTIONS.every(({ order }) => Number.isFinite(order))).toBe(
      true,
    );
  });
});
