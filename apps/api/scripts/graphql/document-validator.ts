import { GraphQLError, type GraphQLSchema } from 'graphql';
import { createYoga } from 'graphql-yoga';

import {
  classifyDocumentErrors,
  type GatewayErrorCode,
} from '../../src/presentation/graphql/error-codes.ts';
import { createQueryLimitPlugins } from '../../src/presentation/graphql/query-limits.ts';

export type DocumentValidator = (
  document: string,
) => readonly GatewayErrorCode[];

// Armorの上限の拒否は解析・検証の途中で例外として投げられるため、返されたエラーと同じく分類の対象にする
function collectDocumentErrors(
  check: () => readonly GraphQLError[],
): readonly GraphQLError[] {
  try {
    return check();
  } catch (error) {
    if (error instanceof GraphQLError) {
      return [error];
    }
    throw error;
  }
}

export function createDocumentValidator(
  schema: GraphQLSchema,
): DocumentValidator {
  const yoga = createYoga({
    schema,
    logging: false,
    plugins: [
      ...createQueryLimitPlugins({
        exposeLimits: false,
        blockFieldSuggestion: false,
      }),
    ],
  });
  return (document) => {
    const enveloped = yoga.getEnveloped({});
    // envelopの解析・検証の関数は戻り値がanyと宣言されているため、graphqlのvalidateの戻り値の型を与える
    const errors = collectDocumentErrors(
      () =>
        enveloped.validate(
          schema,
          enveloped.parse(document),
        ) as readonly GraphQLError[],
    );
    return classifyDocumentErrors(errors);
  };
}
