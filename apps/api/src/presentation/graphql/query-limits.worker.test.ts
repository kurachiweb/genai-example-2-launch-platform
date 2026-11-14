import { describe, expect, test } from 'vitest';

import {
  aliasQuery,
  costQuery,
  depthQuery,
  directiveQuery,
  runLimitedOperation,
  tokenQuery,
} from '../../../test/support/query-limit-harness.ts';
import {
  classifyDocumentErrors,
  type GatewayErrorCode,
} from './error-codes.ts';
import { createQueryLimitPlugins } from './query-limits.ts';

const DEPLOYED_OPTIONS = { exposeLimits: false, blockFieldSuggestion: true };
const LOCAL_OPTIONS = { exposeLimits: true, blockFieldSuggestion: false };

const HIDDEN_LIMIT_MESSAGE = 'Syntax Error: Query validation error.';

const OVER_LIMIT_CASES = [
  ['深さ9', 'query_depth_exceeded', depthQuery(9)],
  ['エイリアス16', 'query_aliases_exceeded', aliasQuery(16)],
  ['コスト5002.1796875', 'query_cost_exceeded', costQuery(289)],
  ['字句1001', 'query_tokens_exceeded', tokenQuery(1001)],
  ['ディレクティブ51', 'query_directives_exceeded', directiveQuery(51)],
] as const satisfies readonly (readonly [string, GatewayErrorCode, string])[];

describe('上限の拒否', () => {
  test.each(OVER_LIMIT_CASES)(
    '%sの操作は%sに分類され、リゾルバを1つも実行しない',
    async (_label, expectedCode, query) => {
      const result = await runLimitedOperation(
        query,
        createQueryLimitPlugins(DEPLOYED_OPTIONS),
      );

      expect(classifyDocumentErrors(result.documentErrors)).toEqual([
        expectedCode,
      ]);
      expect(result.body.data).toBeUndefined();
      expect(result.resolverCalls).toBe(0);
    },
  );

  test.each([
    ['深さ8', depthQuery(8)],
    ['エイリアス15', aliasQuery(15)],
    ['コスト4985.09375', costQuery(288)],
    ['字句1000', tokenQuery(1000)],
    ['ディレクティブ50', directiveQuery(50)],
  ])('上限ちょうどの%sの操作は実行される', async (_label, query) => {
    const result = await runLimitedOperation(
      query,
      createQueryLimitPlugins(DEPLOYED_OPTIONS),
    );

    expect(result.body.errors).toBeUndefined();
    expect(result.documentErrors).toEqual([]);
    expect(result.body.data).toBeDefined();
    expect(result.resolverCalls).toBeGreaterThan(0);
  });
});

describe('解析・検証の失敗の分類', () => {
  test('構文の誤りはgraphql_parse_failedに分類される', async () => {
    const result = await runLimitedOperation(
      '{ value',
      createQueryLimitPlugins(DEPLOYED_OPTIONS),
    );

    expect(classifyDocumentErrors(result.documentErrors)).toEqual([
      'graphql_parse_failed',
    ]);
    expect(result.resolverCalls).toBe(0);
  });

  test('存在しない項目はgraphql_validation_failedに分類される', async () => {
    const result = await runLimitedOperation(
      '{ valeu }',
      createQueryLimitPlugins(DEPLOYED_OPTIONS),
    );

    expect(classifyDocumentErrors(result.documentErrors)).toEqual([
      'graphql_validation_failed',
    ]);
    expect(result.resolverCalls).toBe(0);
  });
});

describe('デプロイ先の設定', () => {
  test.each(OVER_LIMIT_CASES)(
    '%sの拒否の応答に上限値と実測値を含めない',
    async (_label, _expectedCode, query) => {
      const result = await runLimitedOperation(
        query,
        createQueryLimitPlugins(DEPLOYED_OPTIONS),
      );

      expect(result.body.errors).toEqual([
        expect.objectContaining({ message: HIDDEN_LIMIT_MESSAGE }),
      ]);
    },
  );

  test('存在しない項目への応答に似た名前の項目の候補を含めない', async () => {
    const result = await runLimitedOperation(
      '{ valeu }',
      createQueryLimitPlugins(DEPLOYED_OPTIONS),
    );

    expect(result.body.errors).toHaveLength(1);
    const message = result.body.errors?.[0]?.message;
    expect(message).toContain('Cannot query field "valeu" on type "Query".');
    expect(message).not.toContain('Did you mean');
    expect(message).not.toContain('"value"');
  });
});

describe('ローカルの設定', () => {
  test.each([
    [
      '深さ9',
      depthQuery(9),
      'Syntax Error: Query depth limit of 8 exceeded, found 9.',
    ],
    [
      'エイリアス16',
      aliasQuery(16),
      'Syntax Error: Aliases limit of 15 exceeded, found 16.',
    ],
    [
      'コスト5002.1796875',
      costQuery(289),
      'Syntax Error: Query Cost limit of 5000 exceeded, found 5002.1796875.',
    ],
    [
      '字句1001',
      tokenQuery(1001),
      'Syntax Error: Token limit of 1000 exceeded.',
    ],
    [
      'ディレクティブ51',
      directiveQuery(51),
      'Syntax Error: Directives limit of 50 exceeded, found 51.',
    ],
  ])(
    '%sの拒否の応答に上限値を含める',
    async (_label, query, expectedMessage) => {
      const result = await runLimitedOperation(
        query,
        createQueryLimitPlugins(LOCAL_OPTIONS),
      );

      expect(result.body.errors).toEqual([
        expect.objectContaining({ message: expectedMessage }),
      ]);
      expect(result.resolverCalls).toBe(0);
    },
  );

  test('存在しない項目への応答に似た名前の項目の候補を含める', async () => {
    const result = await runLimitedOperation(
      '{ valeu }',
      createQueryLimitPlugins(LOCAL_OPTIONS),
    );

    expect(result.body.errors).toHaveLength(1);
    expect(result.body.errors?.[0]?.message).toContain('Did you mean "value"?');
  });
});
