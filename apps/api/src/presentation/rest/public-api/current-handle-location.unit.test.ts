import { describe, expect, test } from 'bun:test';

import { currentHandleLocation } from './current-handle-location.ts';

const ORIGIN = 'https://api.launch.example';

describe('旧ハンドルの転送先', () => {
  test('経路のパターンのハンドルの位置だけを現在のハンドルに置き換え、他の区画とクエリを保つ', () => {
    expect(
      currentHandleLocation({
        requestUrl: `${ORIGIN}/v1/products/old-alpha/launches/01JD01NCH00000000000000001/comments?cursor=abc&x=1`,
        routePath: '/v1/products/:handle/launches/:launch_id/comments',
        handle: 'Alpha',
      }),
    ).toBe(
      `${ORIGIN}/v1/products/Alpha/launches/01JD01NCH00000000000000001/comments?cursor=abc&x=1`,
    );
  });

  test('ハンドルが末尾の区画でも置き換え、クエリが無ければ付けない', () => {
    expect(
      currentHandleLocation({
        requestUrl: `${ORIGIN}/v1/users/old_bob`,
        routePath: '/v1/users/:handle',
        handle: 'bob',
      }),
    ).toBe(`${ORIGIN}/v1/users/bob`);
  });

  test('他の区画が旧ハンドルと同じ文字列でも、ハンドルの位置だけを置き換える', () => {
    expect(
      currentHandleLocation({
        requestUrl: `${ORIGIN}/v1/products/products/launches`,
        routePath: '/v1/products/:handle/launches',
        handle: 'Alpha',
      }),
    ).toBe(`${ORIGIN}/v1/products/Alpha/launches`);
  });

  test('現在のハンドルをパスの区画として符号化する', () => {
    expect(
      currentHandleLocation({
        requestUrl: `${ORIGIN}/v1/products/old`,
        routePath: '/v1/products/:handle',
        handle: 'a/b?c',
      }),
    ).toBe(`${ORIGIN}/v1/products/a%2Fb%3Fc`);
  });

  test('経路のパターンにハンドルの変数が無い、または区画の数が要求のパスと合わなければ例外を投げる', () => {
    expect(() =>
      currentHandleLocation({
        requestUrl: `${ORIGIN}/v1/me/profile`,
        routePath: '/v1/me/profile',
        handle: 'Alpha',
      }),
    ).toThrow(TypeError);
    expect(() =>
      currentHandleLocation({
        requestUrl: `${ORIGIN}/v1/products/old/launches`,
        routePath: '/v1/products/:handle',
        handle: 'Alpha',
      }),
    ).toThrow(TypeError);
  });
});
