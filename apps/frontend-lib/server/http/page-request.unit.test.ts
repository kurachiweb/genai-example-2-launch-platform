import { describe, expect, test } from 'bun:test';

import {
  isPageRequest,
  isServerFunctionCall,
  SAFE_METHODS,
  SERVER_FUNCTION_PATH_PREFIX,
} from './page-request.ts';

const HTML_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const requestOf = (method: string, accept?: string): Request =>
  new Request('https://app.example/items', {
    method,
    headers: accept === undefined ? {} : { Accept: accept },
  });

describe('SAFE_METHODS', () => {
  test('GET・HEAD・OPTIONSだけを持つ', () => {
    expect([...SAFE_METHODS].toSorted()).toEqual(['GET', 'HEAD', 'OPTIONS']);
  });
});

describe('isPageRequest', () => {
  test.each(['GET', 'HEAD'])(
    '%sでAcceptがtext/htmlを含めばページの要求とする',
    (method) => {
      expect(isPageRequest(requestOf(method, HTML_ACCEPT))).toBe(true);
    },
  );

  test('Acceptのtext/htmlは大文字小文字を区別しない', () => {
    expect(isPageRequest(requestOf('GET', 'TEXT/HTML'))).toBe(true);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    '%sはAcceptがtext/htmlを含んでもページの要求としない',
    (method) => {
      expect(isPageRequest(requestOf(method, HTML_ACCEPT))).toBe(false);
    },
  );

  test.each([
    ['application/json', 'application/json'],
    ['すべての形式', '*/*'],
    ['GraphQLの応答', 'application/graphql-response+json'],
  ])('Acceptが%sだけならページの要求としない', (_, accept) => {
    expect(isPageRequest(requestOf('GET', accept))).toBe(false);
  });

  test('Acceptが無ければページの要求としない', () => {
    expect(isPageRequest(requestOf('GET'))).toBe(false);
  });
});

describe('isServerFunctionCall', () => {
  test('接頭辞はTanStack Startの既定の/_serverFn/である', () => {
    expect(SERVER_FUNCTION_PATH_PREFIX).toBe('/_serverFn/');
  });

  test.each([
    'https://app.example/_serverFn/abc123',
    'https://app.example/_serverFn/abc123?payload=%7B%7D',
    'https://app.example/_serverFn/abc123/extra',
  ])('%sはサーバー関数の呼び出しとする', (url) => {
    expect(isServerFunctionCall(new URL(url))).toBe(true);
  });

  test.each([
    'https://app.example/',
    'https://app.example/_serverFn',
    'https://app.example/_serverFnX/abc123',
    'https://app.example/items/_serverFn/abc123',
    'https://app.example/_bff/graphql',
    'https://app.example/items?next=/_serverFn/abc123',
  ])('%sはサーバー関数の呼び出しとしない', (url) => {
    expect(isServerFunctionCall(new URL(url))).toBe(false);
  });

  // TanStack Startは経路を、%25と%5Cの前後で区切った各部分をdecodeURIで解除し(失敗した部分は%XXごとに解除し)てから接頭辞と比べる
  describe('TanStack Startと同じくパーセントエンコードを解除してから判定する', () => {
    test.each([
      ['_を%5Fにした経路', 'https://app.example/%5FserverFn/abc'],
      ['_を小文字の%5fにした経路', 'https://app.example/%5fserverFn/abc'],
      ['FをエンコードしたFの経路', 'https://app.example/_server%46n/abc'],
      [
        '複数の文字をエンコードした経路',
        'https://app.example/%5f%73erverFn/abc',
      ],
      ['不正なエスケープを含む経路', 'https://app.example/_serverFn/%E0%A4%A'],
      [
        '不正なエスケープと解除できるエスケープが混ざる経路',
        'https://app.example/%5FserverFn/%E0%A4%A',
      ],
    ])('%sはサーバー関数の呼び出しとする(%s)', (_, url) => {
      expect(isServerFunctionCall(new URL(url))).toBe(true);
    });

    test.each([
      ['区切りの/を%2Fにした経路', 'https://app.example/_serverFn%2Fabc'],
      ['解除しても接頭辞と違う経路', 'https://app.example/%5FserverFnX/abc'],
      [
        '%25で二重にエンコードした経路',
        'https://app.example/_server%2546n/abc',
      ],
      ['区切りを%5Cにした経路', 'https://app.example/_serverFn%5Cabc'],
    ])('%sはサーバー関数の呼び出しとしない(%s)', (_, url) => {
      expect(isServerFunctionCall(new URL(url))).toBe(false);
    });
  });
});
