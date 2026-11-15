import { graphql, GraphQLError, type GraphQLSchema } from 'graphql';
import { describe, expect, test } from 'vitest';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  composeGatewaySchema,
  printGatewaySchema,
  SchemaCompositionError,
} from './schema-composer.ts';
import {
  defineSchemaModule,
  type GraphQLSchemaModule,
} from './schema-module.ts';

const greetingModule = defineSchemaModule({
  name: 'greeting',
  typeDefs: /* GraphQL */ `
    type Query {
      greeting: String!
    }

    type Mutation {
      greet(name: String!): String!
    }
  `,
  resolvers: {
    Query: { greeting: () => 'こんにちは' },
    Mutation: {
      greet: (_parent: unknown, args: { name: string }) =>
        `こんにちは、${args.name}`,
    },
  },
});

const clockModule = defineSchemaModule({
  name: 'clock',
  typeDefs: /* GraphQL */ `
    type Query {
      now: DateTime!
      shift(at: DateTime!): DateTime!
    }

    type Mutation {
      tick: Int!
    }
  `,
  resolvers: {
    Query: {
      now: () => Date.UTC(2026, 9, 26, 3, 4, 5, 678),
      shift: (_parent: unknown, args: { at: number }) => args.at + 1000,
    },
    Mutation: { tick: () => 1 },
  },
});

function moduleWith(name: string, typeDefs: string): GraphQLSchemaModule {
  return defineSchemaModule({ name, typeDefs });
}

function captureCompositionError(
  modules: readonly GraphQLSchemaModule[],
): SchemaCompositionError {
  try {
    composeGatewaySchema(modules);
  } catch (error) {
    if (error instanceof SchemaCompositionError) {
      return error;
    }
    throw error;
  }
  throw new Error('合成エラーが投げられませんでした');
}

async function execute(
  schema: GraphQLSchema,
  source: string,
  variableValues?: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof graphql>>> {
  return graphql({ schema, source, variableValues });
}

describe('defineSchemaModule', () => {
  test('渡したモジュールの定義をそのまま返す', () => {
    const module = { name: 'sample', typeDefs: 'type Query { a: Int }' };

    expect(defineSchemaModule(module)).toEqual(module);
  });
});

describe('composeGatewaySchema', () => {
  test('複数モジュールのQueryとMutationを1つのスキーマへ結合する', async () => {
    const schema = composeGatewaySchema([greetingModule, clockModule]);

    const queryResult = await execute(schema, '{ greeting tick: __typename }');
    const mutationResult = await execute(
      schema,
      'mutation { greet(name: "太郎") tick }',
    );

    expect(Object.keys(schema.getQueryType()?.getFields() ?? {})).toEqual(
      expect.arrayContaining(['greeting', 'now', 'shift']),
    );
    expect(queryResult).toEqual({
      data: { greeting: 'こんにちは', tick: 'Query' },
    });
    expect(mutationResult).toEqual({
      data: { greet: 'こんにちは、太郎', tick: 1 },
    });
  });

  test('基盤の型定義を含めて合成する', () => {
    const schema = composeGatewaySchema([greetingModule]);

    expect(schema.getType('DateTime')).toBeDefined();
    expect(schema.getType('PageInfo')).toBeDefined();
    expect(schema.getType('OffsetPageInfo')).toBeDefined();
  });

  test('日時の項目をUTCのRFC 3339の文字列で出力する', async () => {
    const schema = composeGatewaySchema([clockModule]);

    const result = await execute(schema, '{ now }');

    expect(result).toEqual({ data: { now: '2026-10-26T03:04:05.678Z' } });
  });

  test('日時の引数をエポックミリ秒としてリゾルバへ渡す', async () => {
    const schema = composeGatewaySchema([clockModule]);

    const result = await execute(
      schema,
      'query Shift($at: DateTime!) { shift(at: $at) }',
      { at: '2026-10-26T12:04:05.678+09:00' },
    );

    expect(result).toEqual({ data: { shift: '2026-10-26T03:04:06.678Z' } });
  });

  test('不正な日時の変数を入力不正として拒否する', async () => {
    const schema = composeGatewaySchema([clockModule]);

    const result = await execute(
      schema,
      'query Shift($at: DateTime!) { shift(at: $at) }',
      { at: '2026-10-26T03:04:05' },
    );

    expect(result.data).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    const coercionError = result.errors?.[0]?.originalError;
    expect(coercionError).toBeInstanceOf(GraphQLError);
    expect((coercionError as GraphQLError).originalError).toBeInstanceOf(
      AppError,
    );
    expect((coercionError as GraphQLError).originalError).toMatchObject({
      code: 'validation_error',
    });
  });

  test('不正な日時のリテラルを入力不正として拒否する', async () => {
    const schema = composeGatewaySchema([clockModule]);

    const result = await execute(schema, '{ shift(at: "yesterday") }');

    expect(result.data).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.originalError).toBeInstanceOf(AppError);
    expect(result.errors?.[0]?.originalError).toMatchObject({
      code: 'validation_error',
    });
  });

  test('モジュール名の重複を合成エラーにする', () => {
    const error = captureCompositionError([
      moduleWith('same', 'type Query { a: Int }'),
      moduleWith('same', 'type Query { b: Int }'),
    ]);

    expect(error.conflicts).toEqual(['module:same']);
  });

  test('基盤の型定義と同じモジュール名を合成エラーにする', () => {
    const error = captureCompositionError([
      moduleWith('platform', 'type Query { a: Int }'),
    ]);

    expect(error.conflicts).toEqual(['module:platform']);
  });

  test('ルート型以外の型を複数モジュールで定義すると合成エラーにする', () => {
    const error = captureCompositionError([
      moduleWith('first', 'type Query { a: Shared } type Shared { x: Int }'),
      moduleWith('second', 'type Query { b: Shared } type Shared { y: Int }'),
    ]);

    expect(error.conflicts).toEqual(['Shared(first, second)']);
  });

  test('基盤の型定義と同じ名前の型を合成エラーにする', () => {
    const error = captureCompositionError([
      moduleWith(
        'paging',
        'type Query { a: PageInfo } type PageInfo { hasNextPage: Boolean! }',
      ),
    ]);

    expect(error.conflicts).toEqual(['PageInfo(platform, paging)']);
  });

  test('同じルート型の同じ項目を複数モジュールで定義すると合成エラーにする', () => {
    const error = captureCompositionError([
      moduleWith('system', 'type Query { status: Int }'),
      moduleWith('other', 'type Query { status: Int }'),
      moduleWith('third', 'type Mutation { run: Int } type Query { c: Int }'),
      moduleWith('fourth', 'type Mutation { run: Int }'),
    ]);

    expect(error.conflicts).toEqual([
      'Query.status(system, other)',
      'Mutation.run(third, fourth)',
    ]);
  });

  test('1つのモジュール内で同じ項目を重ねて定義すると合成エラーにする', () => {
    const error = captureCompositionError([
      moduleWith('single', 'type Query { a: Int } type Query { a: Int }'),
    ]);

    expect(error.conflicts).toEqual(['Query.a(single, single)']);
  });

  test('列挙型の値と入力型の項目の重複を合成エラーにする', () => {
    const error = captureCompositionError([
      moduleWith(
        'catalog',
        /* GraphQL */ `
          type Query {
            items(filter: ItemFilter): [Int!]!
          }
          enum Status {
            OPEN
            OPEN
          }
          input ItemFilter {
            status: Status
            status: Status
          }
        `,
      ),
    ]);

    expect(error.conflicts).toEqual([
      'Status.OPEN(catalog, catalog)',
      'ItemFilter.status(catalog, catalog)',
    ]);
  });

  test('合成エラーの文言に衝突した定義を全て含める', () => {
    const error = captureCompositionError([
      moduleWith('same', 'type Query { a: Int }'),
      moduleWith('same', 'type Query { a: Int }'),
    ]);

    expect(error.message).toContain('module:same');
    expect(error.message).toContain('Query.a(same, same)');
  });

  test('スキーマに無い項目のリゾルバを渡すと合成に失敗する', () => {
    const module = defineSchemaModule({
      name: 'broken',
      typeDefs: 'type Query { a: Int }',
      resolvers: { Query: { missing: () => 1 } },
    });

    expect(() => composeGatewaySchema([module])).toThrow(/missing/u);
  });

  test('スキーマに無い型のリゾルバを渡すと合成に失敗する', () => {
    const module = defineSchemaModule({
      name: 'broken',
      typeDefs: 'type Query { a: Int }',
      resolvers: { Unknown: { field: () => 1 } },
    });

    expect(() => composeGatewaySchema([module])).toThrow(/Unknown/u);
  });
});

describe('printGatewaySchema', () => {
  test('型と項目を名前順に並べて印字する', () => {
    const printed = printGatewaySchema(
      composeGatewaySchema([greetingModule, clockModule]),
    );

    const typeOrder = [
      ...printed.matchAll(/^(?:type|scalar|input|enum) (\w+)/gmu),
    ].map((match) => match[1]);
    expect(typeOrder).toEqual(typeOrder.toSorted());
    expect(printed).toContain(
      'type Query {\n  greeting: String!\n  now: DateTime!\n  shift(at: DateTime!): DateTime!\n}',
    );
    expect(printed).toContain(
      'type PageInfo {\n  endCursor: String\n  hasNextPage: Boolean!\n}',
    );
    expect(printed).toContain('scalar DateTime');
    expect(printed).toContain('UTCのRFC 3339形式の日時');
  });

  test('同じ定義からはモジュールの順序によらず同じ文字列を印字する', () => {
    const forward = printGatewaySchema(
      composeGatewaySchema([greetingModule, clockModule]),
    );
    const backward = printGatewaySchema(
      composeGatewaySchema([clockModule, greetingModule]),
    );

    expect(backward).toBe(forward);
    expect(
      printGatewaySchema(composeGatewaySchema([greetingModule, clockModule])),
    ).toBe(forward);
  });

  test('末尾を1つの改行で終える', () => {
    const printed = printGatewaySchema(composeGatewaySchema([greetingModule]));

    expect(printed.endsWith('}\n')).toBe(true);
    expect(printed.endsWith('\n\n')).toBe(false);
  });
});
