import { describe, expect, test } from 'bun:test';
import { buildSchema, GraphQLError, parse, validate } from 'graphql';

import {
  classifyDocumentErrors,
  limitKindOf,
  type QueryLimitKind,
  recordLimitRejection,
} from './error-codes.ts';

const SCHEMA = buildSchema('type Query { value: Int }');

function syntaxErrorOf(source: string): GraphQLError {
  try {
    parse(source);
  } catch (error) {
    if (error instanceof GraphQLError) {
      return error;
    }
    throw error;
  }
  throw new Error('構文の誤りになりませんでした');
}

describe('上限の拒否の記録', () => {
  test('記録していないエラーの種類は無い', () => {
    expect(limitKindOf(new GraphQLError('Syntax Error: x'))).toBeUndefined();
  });

  test('記録したエラーだけが種類を持つ', () => {
    const recorded = new GraphQLError('Syntax Error: Query validation error.');
    const other = new GraphQLError('Syntax Error: Query validation error.');

    recordLimitRejection(recorded, 'cost');

    expect(limitKindOf(recorded)).toBe('cost');
    expect(limitKindOf(other)).toBeUndefined();
  });
});

describe('classifyDocumentErrors', () => {
  test.each([
    ['depth', 'query_depth_exceeded'],
    ['cost', 'query_cost_exceeded'],
    ['aliases', 'query_aliases_exceeded'],
    ['tokens', 'query_tokens_exceeded'],
    ['directives', 'query_directives_exceeded'],
  ] as const satisfies readonly (readonly [QueryLimitKind, string])[])(
    '上限%sの拒否は%sに分類する',
    (kind, expectedCode) => {
      const error = new GraphQLError('Syntax Error: Query validation error.');
      recordLimitRejection(error, kind);

      expect(classifyDocumentErrors([error])).toEqual([expectedCode]);
    },
  );

  test('構文の誤りはgraphql_parse_failedに分類する', () => {
    expect(classifyDocumentErrors([syntaxErrorOf('{ value')])).toEqual([
      'graphql_parse_failed',
    ]);
  });

  test('検証の失敗はgraphql_validation_failedに分類する', () => {
    const errors = validate(SCHEMA, parse('{ valeu }'));

    expect(classifyDocumentErrors(errors)).toEqual([
      'graphql_validation_failed',
    ]);
  });

  test('複数のエラーをそれぞれ同じ順で分類する', () => {
    const limitError = new GraphQLError(
      'Syntax Error: Query validation error.',
    );
    recordLimitRejection(limitError, 'depth');
    const [validationError] = validate(SCHEMA, parse('{ valeu }'));
    if (validationError === undefined) {
      throw new Error('検証の失敗になりませんでした');
    }

    expect(
      classifyDocumentErrors([validationError, limitError, syntaxErrorOf('}')]),
    ).toEqual([
      'graphql_validation_failed',
      'query_depth_exceeded',
      'graphql_parse_failed',
    ]);
  });

  test('エラーが無ければ空の配列を返す', () => {
    expect(classifyDocumentErrors([])).toEqual([]);
  });
});
