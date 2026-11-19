import { describe, expect, test } from 'bun:test';

import { toApiKeyScopes, toApiKeyScopesInput } from './public-api.ts';

describe('権限の値とGraphQLの列挙型の対応', () => {
  test('フォームの値の小文字の権限を、GraphQLの入力の大文字の列挙型にする', () => {
    expect(
      toApiKeyScopesInput({
        products: 'read',
        launches: 'none',
        upvotes: 'read',
        comments: 'none',
        ratings: 'read',
        profile: 'read_write',
        productDescriptions: 'read',
      }),
    ).toStrictEqual({
      products: 'READ',
      launches: 'NONE',
      upvotes: 'READ',
      comments: 'NONE',
      ratings: 'READ',
      profile: 'READ_WRITE',
      productDescriptions: 'READ',
    });
  });

  test('GraphQLの応答の大文字の列挙型を、表示名を引く共用部品の小文字の権限にする', () => {
    expect(
      toApiKeyScopes({
        products: 'NONE',
        launches: 'READ',
        upvotes: 'NONE',
        comments: 'READ',
        ratings: 'NONE',
        profile: 'NONE',
        productDescriptions: 'READ_WRITE',
      }),
    ).toStrictEqual({
      products: 'none',
      launches: 'read',
      upvotes: 'none',
      comments: 'read',
      ratings: 'none',
      profile: 'none',
      productDescriptions: 'read_write',
    });
  });

  test('相互に写すと元の値に戻る', () => {
    const scopes = {
      products: 'READ',
      launches: 'READ',
      upvotes: 'READ',
      comments: 'READ',
      ratings: 'READ',
      profile: 'READ',
      productDescriptions: 'NONE',
    } as const;

    expect(toApiKeyScopesInput(toApiKeyScopes(scopes))).toStrictEqual(scopes);
  });
});
