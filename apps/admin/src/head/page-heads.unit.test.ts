import { describe, expect, test } from 'bun:test';

import { buildAdminPageHead, buildRootHead } from './page-heads.ts';

const STYLESHEET_HREF = '/assets/styles-abc123.css';

describe('buildRootHead', () => {
  test('文字コード・表示領域・管理画面の名前のタイトルと、スタイルシートだけを置き、アクセス解析のスクリプトを置かない', () => {
    expect(buildRootHead({ stylesheetHref: STYLESHEET_HREF })).toStrictEqual({
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: 'Launch Stadium管理' },
      ],
      links: [{ rel: 'stylesheet', href: STYLESHEET_HREF }],
    });
  });
});

describe('buildAdminPageHead', () => {
  test('ページ名が空なら管理画面の名前だけのタイトルにする', () => {
    expect(buildAdminPageHead({ title: '' })).toStrictEqual({
      meta: [{ title: 'Launch Stadium管理' }],
      links: [],
    });
  });

  test('ページ名と管理画面の名前のタイトルにし、検索除外を指定するとrobotsのmetaで登録とリンクの追跡を断る', () => {
    expect(
      buildAdminPageHead({ title: '疎通確認', noIndex: true }),
    ).toStrictEqual({
      meta: [
        { title: '疎通確認 | Launch Stadium管理' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      links: [],
    });
  });
});
