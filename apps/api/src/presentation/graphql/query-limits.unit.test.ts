import { describe, expect, test } from 'bun:test';

import {
  aliasQuery,
  costQuery,
  depthQuery,
  directiveQuery,
  runLimitedOperation,
  tokenQuery,
} from '../../../test/support/query-limit-harness.ts';
import { limitKindOf, type QueryLimitKind } from './error-codes.ts';
import { createQueryLimitPlugins, QUERY_LIMITS } from './query-limits.ts';

const DEPLOYED_OPTIONS = { exposeLimits: false, blockFieldSuggestion: true };

describe('QUERY_LIMITS', () => {
  test('上限値は要件の値で、実行時に書き換えられない', () => {
    expect(QUERY_LIMITS).toEqual({
      maxDepth: 8,
      maxCost: 5000,
      objectCost: 2,
      scalarCost: 1,
      depthCostFactor: 1.5,
      maxAliases: 15,
      maxTokens: 1000,
      maxDirectives: 50,
    });
    expect(Object.isFrozen(QUERY_LIMITS)).toBe(true);
  });
});

describe('createQueryLimitPlugins', () => {
  test.each([
    ['depth', depthQuery(9)],
    ['aliases', aliasQuery(16)],
    ['cost', costQuery(289)],
    ['tokens', tokenQuery(1001)],
    ['directives', directiveQuery(51)],
  ] as const satisfies readonly (readonly [QueryLimitKind, string])[])(
    '上限%sを超えた操作を拒否し、拒否のエラーに上限の種類を記録する',
    async (kind, query) => {
      const result = await runLimitedOperation(
        query,
        createQueryLimitPlugins(DEPLOYED_OPTIONS),
      );

      expect(result.documentErrors.map((error) => limitKindOf(error))).toEqual([
        kind,
      ]);
      expect(result.resolverCalls).toBe(0);
    },
  );

  test('上限以内の操作は実行する', async () => {
    const result = await runLimitedOperation(
      depthQuery(8),
      createQueryLimitPlugins(DEPLOYED_OPTIONS),
    );

    expect(result.documentErrors).toEqual([]);
    expect(result.resolverCalls).toBeGreaterThan(0);
  });
});
