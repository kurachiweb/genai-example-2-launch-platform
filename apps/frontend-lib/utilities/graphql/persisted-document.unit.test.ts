import { describe, expect, test } from 'bun:test';

import {
  type DocumentId,
  documentIdOf,
  graphqlQueryKey,
  type PersistedDocument,
} from './persisted-document.ts';

interface ProductQuery {
  readonly product: { readonly id: string } | null;
}

interface ProductQueryVariables {
  readonly id: string;
}

const DOCUMENT_ID: DocumentId = `sha256:${'0123456789abcdef'.repeat(4)}`;

const generatedDocument = (
  meta: unknown,
): PersistedDocument<ProductQuery, ProductQueryVariables> =>
  ({ __meta__: meta }) as unknown as PersistedDocument<
    ProductQuery,
    ProductQueryVariables
  >;

describe('documentIdOf', () => {
  test('生成された文書に載る識別子を返す', () => {
    const document = generatedDocument({ hash: DOCUMENT_ID });

    expect(documentIdOf(document)).toBe(DOCUMENT_ID);
  });

  test('識別子を持たない文書は例外にする', () => {
    const document = generatedDocument(undefined);

    expect(() => documentIdOf(document)).toThrow(
      '操作の識別子を持たない文書です',
    );
  });

  test('識別子の欄が無い文書は例外にする', () => {
    const document = generatedDocument({});

    expect(() => documentIdOf(document)).toThrow(
      '操作の識別子を持たない文書です',
    );
  });

  test('識別子の形式に合わない値は例外にする', () => {
    const invalidIds = [
      '0123456789abcdef'.repeat(4),
      `sha1:${'0123456789abcdef'.repeat(4)}`,
      `sha256:${'0123456789ABCDEF'.repeat(4)}`,
      `sha256:${'0123456789abcdef'.repeat(4)}0`,
      'sha256:',
    ];

    for (const invalidId of invalidIds) {
      expect(() =>
        documentIdOf(generatedDocument({ hash: invalidId })),
      ).toThrow('操作の識別子を持たない文書です');
    }
  });
});

describe('graphqlQueryKey', () => {
  test('識別子と変数の組を取得のキーにする', () => {
    const document = generatedDocument({ hash: DOCUMENT_ID });
    const variables: ProductQueryVariables = { id: 'product-1' };

    expect(graphqlQueryKey(document, variables)).toEqual([
      DOCUMENT_ID,
      { id: 'product-1' },
    ]);
  });

  test('変数が異なれば異なるキーになり、同じ値なら同じキーになる', () => {
    const document = generatedDocument({ hash: DOCUMENT_ID });

    const first = graphqlQueryKey(document, { id: 'product-1' });
    const same = graphqlQueryKey(document, { id: 'product-1' });
    const other = graphqlQueryKey(document, { id: 'product-2' });

    expect(first).toEqual(same);
    expect(first).not.toEqual(other);
  });

  test('識別子を持たない文書からはキーを作らない', () => {
    const document = generatedDocument(undefined);

    expect(() => graphqlQueryKey(document, { id: 'product-1' })).toThrow(
      '操作の識別子を持たない文書です',
    );
  });
});
