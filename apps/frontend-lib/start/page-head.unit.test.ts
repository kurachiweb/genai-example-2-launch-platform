import { describe, expect, test } from 'bun:test';

import { buildPageHead, NO_INDEX_ROBOTS_CONTENT } from './page-head.ts';

const SITE_NAME = 'サイト名';

describe('buildPageHead', () => {
  test('タイトルを「ページ名 | サイト名」にし、正規のURLと検索除外が無ければ他のタグを返さない', () => {
    const head = buildPageHead({ title: 'ディレクトリ', siteName: SITE_NAME });

    expect(head).toEqual({
      meta: [{ title: 'ディレクトリ | サイト名' }],
      links: [],
    });
  });

  test('ページ名が空ならサイト名だけをタイトルにする', () => {
    const head = buildPageHead({ title: '  ', siteName: SITE_NAME });

    expect(head.meta).toEqual([{ title: 'サイト名' }]);
  });

  test('ページ名とサイト名の前後の空白を除く', () => {
    const head = buildPageHead({ title: ' 設定 ', siteName: ' サイト名 ' });

    expect(head.meta).toEqual([{ title: '設定 | サイト名' }]);
  });

  test('検索除外の指示ならrobotsのmetaにnoindexとnofollowを付ける', () => {
    const head = buildPageHead({
      title: '疎通確認',
      siteName: SITE_NAME,
      noIndex: true,
    });

    expect(NO_INDEX_ROBOTS_CONTENT).toBe('noindex, nofollow');
    expect(head.meta).toEqual([
      { title: '疎通確認 | サイト名' },
      { name: 'robots', content: 'noindex, nofollow' },
    ]);
  });

  test('検索除外を指示しなければrobotsのmetaを付けない', () => {
    const head = buildPageHead({
      title: 'トップ',
      siteName: SITE_NAME,
      noIndex: false,
    });

    expect(head.meta).toEqual([{ title: 'トップ | サイト名' }]);
  });

  test('正規のURLのパスからcanonicalのlinkを作る', () => {
    const head = buildPageHead({
      title: 'プロダクト',
      siteName: SITE_NAME,
      canonicalUrl: '/products/my-product',
    });

    expect(head.links).toEqual([
      { rel: 'canonical', href: '/products/my-product' },
    ]);
  });

  test.each([
    ['クエリを除く', '/products?sort=new', '/products'],
    ['フラグメントを除く', '/terms#section-2', '/terms'],
    ['クエリとフラグメントを除く', '/a?b=c#d', '/a'],
    ['相対の区切りを解決する', '/products/./a/../b', '/products/b'],
    [
      'エンコードが要る文字をエンコードする',
      '/users/山田 太郎',
      '/users/%E5%B1%B1%E7%94%B0%20%E5%A4%AA%E9%83%8E',
    ],
  ])('正規のURLを正規化する(%s)', (_label, canonicalUrl, href) => {
    const head = buildPageHead({
      title: 'ページ',
      siteName: SITE_NAME,
      canonicalUrl,
    });

    expect(head.links).toEqual([{ rel: 'canonical', href }]);
  });

  test.each([
    ['外部のオリジンの絶対URL', 'https://evil.example/products'],
    ['プロトコル相対のURL', '//evil.example/products'],
    ['バックスラッシュで始まるURL', '/\\evil.example/products'],
    ['相対のパス', 'products/a'],
    ['空文字', ''],
    ['javascriptのURL', 'javascript:alert(1)'],
    ['制御文字を含むURL', '/\t/evil.example'],
    ['解釈できないホストを隠したURL', '/\t/[invalid'],
  ])(
    '正規のURLが%sなら外部を指し得るためcanonicalのlinkを付けない',
    (_label, canonicalUrl) => {
      const head = buildPageHead({
        title: 'ページ',
        siteName: SITE_NAME,
        canonicalUrl,
      });

      expect(head.links).toEqual([]);
      expect(head.meta).toEqual([{ title: 'ページ | サイト名' }]);
    },
  );

  test('タイトル・検索除外・正規のURLを同時に返す', () => {
    const head = buildPageHead({
      title: '管理画面',
      siteName: SITE_NAME,
      canonicalUrl: '/dashboard',
      noIndex: true,
    });

    expect(head).toEqual({
      meta: [
        { title: '管理画面 | サイト名' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      links: [{ rel: 'canonical', href: '/dashboard' }],
    });
  });

  test('返すhead定義は凍結されている', () => {
    const head = buildPageHead({
      title: 'ページ',
      siteName: SITE_NAME,
      canonicalUrl: '/page',
      noIndex: true,
    });

    expect(Object.isFrozen(head)).toBe(true);
    expect(Object.isFrozen(head.meta)).toBe(true);
    expect(Object.isFrozen(head.links)).toBe(true);
    expect(head.meta.every((tag) => Object.isFrozen(tag))).toBe(true);
    expect(head.links.every((tag) => Object.isFrozen(tag))).toBe(true);
  });
});
