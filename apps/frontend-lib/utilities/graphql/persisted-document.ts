import type { TypedDocumentNode } from '@graphql-typed-document-node/core';

export type PersistedDocument<TResult, TVariables> = TypedDocumentNode<
  TResult,
  TVariables
> & {
  readonly __meta__?: { readonly hash?: string };
};

export type DocumentId = `sha256:${string}`;

const DOCUMENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const isDocumentId = (value: unknown): value is DocumentId =>
  typeof value === 'string' && DOCUMENT_ID_PATTERN.test(value);

export const documentIdOf = <TResult, TVariables>(
  document: PersistedDocument<TResult, TVariables>,
): DocumentId => {
  const hash = document.__meta__?.hash;
  if (!isDocumentId(hash)) {
    throw new TypeError(
      '操作の識別子を持たない文書です。コード生成を実行してください。',
    );
  }
  return hash;
};

export const graphqlQueryKey = <TResult, TVariables>(
  document: PersistedDocument<TResult, TVariables>,
  variables: TVariables,
): readonly [DocumentId, TVariables] => [documentIdOf(document), variables];
