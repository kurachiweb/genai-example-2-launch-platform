import { describe, expect, test } from 'bun:test';

import { WEB_ANALYTICS_BEACON_SRC } from '../../lib/start/observability/web-analytics.ts';
import { buildRootHead, buildSitePageHead } from './page-heads.ts';

const STYLESHEET_HREF = '/assets/styles-abc123.css';
const WEB_ANALYTICS_TOKEN = '0123456789abcdef0123456789abcdef';

describe('buildRootHead', () => {
  test('文字コード・表示領域・サイト名のタイトルと、スタイルシートを置く', () => {
    const head = buildRootHead({
      stylesheetHref: STYLESHEET_HREF,
      webAnalyticsToken: undefined,
    });

    expect(head.meta).toStrictEqual([
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Launch Stadium' },
    ]);
    expect(head.links).toStrictEqual([
      { rel: 'stylesheet', href: STYLESHEET_HREF },
    ]);
  });

  test('アクセス解析のトークンがあれば、計測スクリプトをdeferで読み込む', () => {
    const head = buildRootHead({
      stylesheetHref: STYLESHEET_HREF,
      webAnalyticsToken: WEB_ANALYTICS_TOKEN,
    });

    expect(head.scripts).toStrictEqual([
      {
        src: WEB_ANALYTICS_BEACON_SRC,
        defer: true,
        'data-cf-beacon': JSON.stringify({ token: WEB_ANALYTICS_TOKEN }),
      },
    ]);
  });

  test('アクセス解析のトークンが無ければ、スクリプトを置かない', () => {
    const head = buildRootHead({
      stylesheetHref: STYLESHEET_HREF,
      webAnalyticsToken: undefined,
    });

    expect(head.scripts).toStrictEqual([]);
  });
});

describe('buildSitePageHead', () => {
  test('ページ名とサイト名のタイトルと、正規のURLを付ける', () => {
    expect(
      buildSitePageHead({ title: 'ディレクトリ', canonicalUrl: '/p' }),
    ).toStrictEqual({
      meta: [{ title: 'ディレクトリ | Launch Stadium' }],
      links: [{ rel: 'canonical', href: '/p' }],
    });
  });

  test('ページ名が空ならサイト名だけのタイトルにする', () => {
    expect(buildSitePageHead({ title: '', canonicalUrl: '/' })).toStrictEqual({
      meta: [{ title: 'Launch Stadium' }],
      links: [{ rel: 'canonical', href: '/' }],
    });
  });

  test('検索除外を指定すると、robotsのmetaで登録とリンクの追跡を断る', () => {
    expect(
      buildSitePageHead({ title: '疎通確認', noIndex: true }),
    ).toStrictEqual({
      meta: [
        { title: '疎通確認 | Launch Stadium' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      links: [],
    });
  });
});
