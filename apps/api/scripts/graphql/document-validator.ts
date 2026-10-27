import {
  type DocumentNode,
  GraphQLError,
  type GraphQLSchema,
  Kind,
  NoSchemaIntrospectionCustomRule,
} from 'graphql';
import { createYoga, type Plugin } from 'graphql-yoga';

import {
  classifyDocumentErrors,
  type GatewayErrorCode,
} from '../../src/presentation/graphql/error-codes.ts';
import { createQueryLimitPlugins } from '../../src/presentation/graphql/query-limits.ts';

export type DocumentValidator = (
  document: string,
) => readonly GatewayErrorCode[];

const ROOT_TYPE_MISSING_CODE =
  'graphql_request_invalid' satisfies GatewayErrorCode;

// 実行時は内部経路の全ての要求でintrospectionを無効にするため、許可リストの操作にも同じ検証の規則を当てる
const disableIntrospection: Plugin = {
  onValidate({ addValidationRule }) {
    addValidationRule(NoSchemaIntrospectionCustomRule);
  },
};

// Armorの上限の拒否は解析・検証の途中で例外として投げられるため、返されたエラーと同じく分類の対象にする
function catchDocumentError<T>(run: () => T): T | GraphQLError {
  try {
    return run();
  } catch (error) {
    if (error instanceof GraphQLError) {
      return error;
    }
    throw error;
  }
}

// graphqlの検証はスキーマに無いルートの型の操作を通し、実行の開始時に要求の不正として拒否するため、検証に通った文書の各操作を同じく拒否する
function rootTypeMissingCodes(
  schema: GraphQLSchema,
  document: DocumentNode,
): readonly GatewayErrorCode[] {
  return document.definitions
    .filter(
      (definition) =>
        definition.kind === Kind.OPERATION_DEFINITION &&
        schema.getRootType(definition.operation) == null,
    )
    .map(() => ROOT_TYPE_MISSING_CODE);
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
      disableIntrospection,
    ],
  });
  return (document) => {
    const enveloped = yoga.getEnveloped({});
    // envelopの解析・検証の関数は戻り値がanyと宣言されているため、graphqlの解析と検証の戻り値の型を与える
    const parsed = catchDocumentError(
      () => enveloped.parse(document) as DocumentNode,
    );
    if (parsed instanceof GraphQLError) {
      return classifyDocumentErrors([parsed]);
    }
    const validated = catchDocumentError(
      () => enveloped.validate(schema, parsed) as readonly GraphQLError[],
    );
    const errors = validated instanceof GraphQLError ? [validated] : validated;
    return errors.length > 0
      ? classifyDocumentErrors(errors)
      : rootTypeMissingCodes(schema, parsed);
  };
}
