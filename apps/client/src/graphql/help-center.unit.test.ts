import { describe, expect, test } from 'bun:test';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientHelpArticleDocument,
  ClientHelpArticleSearchDocument,
  ClientHelpCenterDocument,
  ClientPinnedHelpArticlesDocument,
} from './generated/graphql.ts';
import {
  helpArticleQueryOptions,
  helpArticleSearchQueryOptions,
  helpCenterQueryOptions,
  pinnedHelpArticlesQueryOptions,
} from './help-center.ts';

describe('helpCenterQueryOptions', () => {
  test('ヘルプトップの操作と空の変数をキーにする', () => {
    expect([...helpCenterQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientHelpCenterDocument, {}),
    ]);
  });
});

describe('helpArticleQueryOptions', () => {
  test('記事詳細の操作と、URLのハンドルの変数をキーにする', () => {
    expect([
      ...helpArticleQueryOptions('how-upvote-works').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientHelpArticleDocument, {
        handle: 'how-upvote-works',
      }),
    ]);
  });

  test('ハンドルが違えば別のキーにする', () => {
    expect([
      ...helpArticleQueryOptions('week-tournament').queryKey,
    ]).not.toStrictEqual([
      ...helpArticleQueryOptions('how-upvote-works').queryKey,
    ]);
  });
});

describe('helpArticleSearchQueryOptions', () => {
  test('検索の操作と、検索語の変数をキーにする', () => {
    expect([
      ...helpArticleSearchQueryOptions('ピン留め').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientHelpArticleSearchDocument, {
        query: 'ピン留め',
      }),
    ]);
  });
});

describe('pinnedHelpArticlesQueryOptions', () => {
  test('フッターのピン留め記事の操作と空の変数をキーにする', () => {
    expect([...pinnedHelpArticlesQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientPinnedHelpArticlesDocument, {}),
    ]);
  });
});
