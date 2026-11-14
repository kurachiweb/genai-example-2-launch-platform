import { useDisableIntrospection } from '@graphql-yoga/plugin-disable-introspection';
import { describe, expect, test } from 'bun:test';
import { createSchema } from 'graphql-yoga';

import {
  classifyDocumentErrors,
  type GatewayErrorCode,
} from '../../src/presentation/graphql/error-codes.ts';
import { createQueryLimitPlugins } from '../../src/presentation/graphql/query-limits.ts';
import {
  aliasQuery,
  costQuery,
  depthQuery,
  directiveQuery,
  runLimitedOperation,
  tokenQuery,
} from '../../test/support/query-limit-harness.ts';
import { createDocumentValidator } from './document-validator.ts';

const TYPE_DEFS = /* GraphQL */ `
  type Query {
    node: Node
    value: Int
  }

  type Node {
    child: Node
    value: Int
  }
`;

function createCountingSchema() {
  const counter = { resolverCalls: 0 };
  const resolve = (value: unknown) => () => {
    counter.resolverCalls += 1;
    return value;
  };
  const schema = createSchema({
    typeDefs: TYPE_DEFS,
    resolvers: {
      Query: { node: resolve({}), value: resolve(1) },
      Node: { child: resolve({}), value: resolve(1) },
    },
  });
  return { schema, counter };
}

describe('createDocumentValidator', () => {
  test.each([
    ['query_depth_exceeded', depthQuery(9)],
    ['query_cost_exceeded', costQuery(289)],
    ['query_aliases_exceeded', aliasQuery(16)],
    ['query_tokens_exceeded', tokenQuery(1001)],
    ['query_directives_exceeded', directiveQuery(51)],
  ] as const satisfies readonly (readonly [GatewayErrorCode, string])[])(
    '上限を超えた操作は%sを返す',
    (expectedCode, document) => {
      const validate = createDocumentValidator(createCountingSchema().schema);

      expect(validate(document)).toEqual([expectedCode]);
    },
  );

  test('構文の誤りはgraphql_parse_failedを返す', () => {
    const validate = createDocumentValidator(createCountingSchema().schema);

    expect(validate('{ node { value }')).toEqual(['graphql_parse_failed']);
  });

  test('存在しない項目はgraphql_validation_failedを返す', () => {
    const validate = createDocumentValidator(createCountingSchema().schema);

    expect(validate('{ missing }')).toEqual(['graphql_validation_failed']);
  });

  test('検証の失敗が複数あればそれぞれのコードを返す', () => {
    const validate = createDocumentValidator(createCountingSchema().schema);

    expect(validate('{ missing node { absent } }')).toEqual([
      'graphql_validation_failed',
      'graphql_validation_failed',
    ]);
  });

  test.each([
    ['深さ', depthQuery(8)],
    ['コスト', costQuery(288)],
    ['エイリアス', aliasQuery(15)],
    ['字句', tokenQuery(1000)],
    ['ディレクティブ', directiveQuery(50)],
  ])('%sが上限以内の操作は合格し、リゾルバを実行しない', (_limit, document) => {
    const { schema, counter } = createCountingSchema();
    const validate = createDocumentValidator(schema);

    expect(validate(document)).toEqual([]);
    expect(counter.resolverCalls).toBe(0);
  });

  test('同じ検証関数で同じ操作を繰り返し検証しても同じコードを返す', () => {
    const validate = createDocumentValidator(createCountingSchema().schema);

    expect(validate(depthQuery(9))).toEqual(['query_depth_exceeded']);
    expect(validate(depthQuery(9))).toEqual(['query_depth_exceeded']);
    expect(validate('{ node')).toEqual(['graphql_parse_failed']);
    expect(validate('{ node')).toEqual(['graphql_parse_failed']);
  });

  test.each([
    ['__schema', 'query Schema { __schema { description } }'],
    ['__type', 'query TypeOf { __type(name: "Node") { name } }'],
  ])(
    '%sを読むintrospectionはgraphql_validation_failedを返す',
    (_field, document) => {
      const validate = createDocumentValidator(createCountingSchema().schema);

      expect(validate(document)).toEqual(['graphql_validation_failed']);
    },
  );

  test('__typenameを読む操作は合格する', () => {
    const validate = createDocumentValidator(createCountingSchema().schema);

    expect(validate('{ __typename node { __typename value } }')).toEqual([]);
  });

  test.each([
    ['Subscription', 'subscription Watch { value }'],
    ['Mutation', 'mutation Change { value }'],
  ])(
    '%s型の無いスキーマへの操作はgraphql_request_invalidを返す',
    (_type, document) => {
      const validate = createDocumentValidator(createCountingSchema().schema);

      expect(validate(document)).toEqual(['graphql_request_invalid']);
    },
  );

  test('Subscription型のあるスキーマへのsubscriptionは合格する', () => {
    const validate = createDocumentValidator(
      createSchema({
        typeDefs: /* GraphQL */ `
          type Query {
            value: Int
          }

          type Subscription {
            value: Int
          }
        `,
      }),
    );

    expect(validate('subscription Watch { value }')).toEqual([]);
  });

  test('複数の操作を持つ文書は合格する', () => {
    const validate = createDocumentValidator(createCountingSchema().schema);

    expect(
      validate('query First { value } query Second { node { value } }'),
    ).toEqual([]);
  });

  test('複数の操作のうちルートの型の無い操作ごとにgraphql_request_invalidを返す', () => {
    const validate = createDocumentValidator(createCountingSchema().schema);

    expect(
      validate(
        'query First { value } subscription Second { value } mutation Third { value }',
      ),
    ).toEqual(['graphql_request_invalid', 'graphql_request_invalid']);
  });

  test('検証に失敗した文書には、ルートの型の無い操作のコードを加えない', () => {
    const validate = createDocumentValidator(createCountingSchema().schema);

    expect(validate('subscription Watch($id: Int) { value }')).toEqual([
      'graphql_validation_failed',
    ]);
  });

  test.each([
    ['深さの超過', depthQuery(9)],
    ['コストの超過', costQuery(289)],
    ['字句の超過', tokenQuery(1001)],
    ['構文の誤り', '{ node { value }'],
    ['存在しない項目', '{ missing }'],
    ['introspection', 'query Schema { __schema { description } }'],
    ['__typename', '{ __typename value }'],
    ['上限以内', depthQuery(8)],
  ])(
    '%sの操作に、同じ上限とintrospectionの無効化を組み込んだYogaの要求と同じコードを返す',
    async (_case, document) => {
      const validate = createDocumentValidator(createCountingSchema().schema);

      const served = await runLimitedOperation(document, [
        ...createQueryLimitPlugins({
          exposeLimits: false,
          blockFieldSuggestion: true,
        }),
        useDisableIntrospection(),
      ]);

      expect(validate(document)).toEqual(
        classifyDocumentErrors(served.documentErrors),
      );
    },
  );
});
