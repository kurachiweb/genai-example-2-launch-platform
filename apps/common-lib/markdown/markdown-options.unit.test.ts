import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_ID_PREFIX,
  type LinkRelToken,
  type MarkdownRenderOptions,
  MarkdownOptionsError,
  idPrefixFor,
  validateRenderOptions,
} from './markdown-options.ts';

const VALID_OPTIONS: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'noreferrer'],
};

const captureError = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
};

const expectOptionsError = (
  action: () => unknown,
  field: MarkdownOptionsError['field'],
): void => {
  const error = captureError(action);

  expect(error).toBeInstanceOf(MarkdownOptionsError);
  expect(error).toBeInstanceOf(Error);
  expect((error as MarkdownOptionsError).name).toBe('MarkdownOptionsError');
  expect((error as MarkdownOptionsError).field).toBe(field);
};

const asRelTokens = (values: readonly string[]): readonly LinkRelToken[] =>
  values as readonly LinkRelToken[];

describe('validateRenderOptions', () => {
  test.each<[string, MarkdownRenderOptions]>([
    ['必須の指定だけ', VALID_OPTIONS],
    [
      '全ての指定',
      {
        siteOrigin: 'https://client.example',
        externalLinkRel: [
          'noopener',
          'noreferrer',
          'nofollow',
          'ugc',
          'sponsored',
        ],
        sameOriginLinkRel: ['nofollow'],
        idScope: 'p42',
      },
    ],
    [
      '空のrel',
      {
        siteOrigin: 'https://client.example',
        externalLinkRel: [],
        sameOriginLinkRel: [],
      },
    ],
    [
      'ポート番号付きのhttpのオリジン',
      { siteOrigin: 'http://localhost:3000', externalLinkRel: ['noopener'] },
    ],
    ['32文字の本文の識別子', { ...VALID_OPTIONS, idScope: 'a'.repeat(32) }],
  ])('%sを受け付ける', (_, options) => {
    expect(() => {
      validateRenderOptions(options);
    }).not.toThrow();
  });

  test.each([
    ['空文字列', ''],
    ['スキームの無い値', 'client.example'],
    ['末尾のスラッシュ', 'https://client.example/'],
    ['パス', 'https://client.example/products'],
    ['クエリ', 'https://client.example?x=1'],
    ['フラグメント', 'https://client.example#top'],
    ['大文字のホスト名', 'https://Client.example'],
    ['既定のポート番号', 'https://client.example:443'],
    ['利用者の情報', 'https://user@client.example'],
    ['httpとhttps以外のスキーム', 'ftp://client.example'],
    ['javascriptのURL', 'javascript:alert(1)'],
    ['mailtoのURL', 'mailto:info@client.example'],
  ])('siteOriginが%sなら例外にする', (_, siteOrigin) => {
    expectOptionsError(() => {
      validateRenderOptions({ ...VALID_OPTIONS, siteOrigin });
    }, 'siteOrigin');
  });

  test.each([
    ['重複した値', ['noopener', 'noopener']],
    ['許可外の値', ['noopener', 'external']],
    ['大文字の値', ['NOOPENER']],
    ['空文字列', ['']],
  ])('externalLinkRelに%sがあれば例外にする', (_, values) => {
    expectOptionsError(() => {
      validateRenderOptions({
        ...VALID_OPTIONS,
        externalLinkRel: asRelTokens(values),
      });
    }, 'externalLinkRel');
  });

  test.each([
    ['重複した値', ['nofollow', 'nofollow']],
    ['許可外の値', ['opener']],
  ])('sameOriginLinkRelに%sがあれば例外にする', (_, values) => {
    expectOptionsError(() => {
      validateRenderOptions({
        ...VALID_OPTIONS,
        sameOriginLinkRel: asRelTokens(values),
      });
    }, 'sameOriginLinkRel');
  });

  test.each([
    ['空文字列', ''],
    ['大文字', 'ABC'],
    ['ハイフン', 'a-b'],
    ['アンダースコア', 'a_b'],
    ['33文字', 'a'.repeat(33)],
    ['日本語', '本文'],
    ['末尾の改行', 'abc\n'],
  ])('idScopeが%sなら例外にする', (_, idScope) => {
    expectOptionsError(() => {
      validateRenderOptions({ ...VALID_OPTIONS, idScope });
    }, 'idScope');
  });
});

describe('idPrefixFor', () => {
  test('本文の識別子が無ければ既定の接頭辞を返す', () => {
    expect(DEFAULT_ID_PREFIX).toBe('user-content-');
    expect(idPrefixFor(undefined)).toBe('user-content-');
  });

  test('本文の識別子があれば識別子を含む接頭辞を返す', () => {
    expect(idPrefixFor('p42')).toBe('user-content-p42-');
  });

  test('形式に合わない本文の識別子は例外にする', () => {
    expectOptionsError(() => idPrefixFor('a-b'), 'idScope');
  });
});
