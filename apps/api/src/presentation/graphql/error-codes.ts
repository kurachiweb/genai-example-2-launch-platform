import type { GraphQLError } from 'graphql';

export type QueryLimitKind =
  'depth' | 'cost' | 'aliases' | 'tokens' | 'directives';

export const GATEWAY_ERROR_CODES = [
  'persisted_operation_required',
  'persisted_operation_not_found',
  'query_depth_exceeded',
  'query_cost_exceeded',
  'query_aliases_exceeded',
  'query_tokens_exceeded',
  'query_directives_exceeded',
  'graphql_parse_failed',
  'graphql_validation_failed',
  'graphql_request_invalid',
  'internal_error',
] as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

// graphqlの構文の誤りは専用の型やコードを持たず、文言の接頭辞だけで検証の失敗と区別できる。Armorの上限の拒否も同じ接頭辞を使うため、分類では記録した上限の種類を先に見る
const SYNTAX_ERROR_PREFIX = 'Syntax Error:';

const limitRejections = new WeakMap<GraphQLError, QueryLimitKind>();

export function recordLimitRejection(
  error: GraphQLError,
  kind: QueryLimitKind,
): void {
  limitRejections.set(error, kind);
}

export function limitKindOf(error: GraphQLError): QueryLimitKind | undefined {
  return limitRejections.get(error);
}

export function classifyDocumentError(error: GraphQLError): GatewayErrorCode {
  const kind = limitKindOf(error);
  if (kind !== undefined) {
    return `query_${kind}_exceeded`;
  }
  return error.message.startsWith(SYNTAX_ERROR_PREFIX)
    ? 'graphql_parse_failed'
    : 'graphql_validation_failed';
}

export function classifyDocumentErrors(
  errors: readonly GraphQLError[],
): readonly GatewayErrorCode[] {
  return errors.map((error) => classifyDocumentError(error));
}
