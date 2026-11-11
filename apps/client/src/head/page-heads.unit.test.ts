import { describe, expect, test } from 'bun:test';

import { WEB_ANALYTICS_BEACON_SRC } from '../../lib/start/observability/web-analytics.ts';
import {
  buildCheckoutHead,
  buildCheckoutReturnHead,
  buildContactHead,
  buildDirectoryHead,
  buildHelpArticleHead,
  buildHelpTopHead,
  buildInquiryChatHead,
  buildLegalDocumentHead,
  buildLegalVersionHead,
  buildPricingHead,
  buildProductPageHead,
  buildPublicProfileHead,
  buildRootHead,
  buildSitePageHead,
} from './page-heads.ts';

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

  test('説明を渡すと、検索エンジン向けのdescriptionのmetaを付ける', () => {
    expect(
      buildSitePageHead({
        title: '料金',
        description: '料金の説明です。',
        canonicalUrl: '/pricing',
      }),
    ).toStrictEqual({
      meta: [
        { title: '料金 | Launch Stadium' },
        { name: 'description', content: '料金の説明です。' },
      ],
      links: [{ rel: 'canonical', href: '/pricing' }],
    });
  });
});

describe('buildPricingHead', () => {
  test('料金のタイトルと検索エンジン向けの説明、料金ページの正規のURLを付ける', () => {
    expect(buildPricingHead()).toStrictEqual({
      meta: [
        { title: '料金 | Launch Stadium' },
        {
          name: 'description',
          content:
            'Ultrasプランの月額料金と特典、スポンサー広告の掲載料金をご案内します。',
        },
      ],
      links: [{ rel: 'canonical', href: '/pricing' }],
    });
  });
});

describe('buildDirectoryHead', () => {
  test('ディレクトリのタイトルと見出しの説明文の説明、条件を含まないディレクトリの正規のURLを付ける', () => {
    expect(buildDirectoryHead()).toStrictEqual({
      meta: [
        { title: 'ディレクトリ | Launch Stadium' },
        {
          name: 'description',
          content: '予選マッチに勝利したプロダクトだけが並ぶカタログです。',
        },
      ],
      links: [{ rel: 'canonical', href: '/p' }],
    });
  });
});

describe('buildHelpTopHead', () => {
  test('ヘルプのタイトルと、検索語を含まないヘルプトップの正規のURLを付ける', () => {
    expect(buildHelpTopHead()).toStrictEqual({
      meta: [{ title: 'ヘルプ | Launch Stadium' }],
      links: [{ rel: 'canonical', href: '/help' }],
    });
  });
});

describe('buildLegalDocumentHead', () => {
  test('公開済みの文書は、文書の名前のタイトルと公開ページの正規のURLを付ける', () => {
    expect(
      buildLegalDocumentHead('privacy', {
        preparing: false,
        canonicalUrl: '/privacy',
      }),
    ).toStrictEqual({
      meta: [{ title: 'プライバシーポリシー | Launch Stadium' }],
      links: [{ rel: 'canonical', href: '/privacy' }],
    });
  });

  test('準備中の文書は、検索の索引の対象外にして正規のURLを付けない', () => {
    expect(
      buildLegalDocumentHead('terms', {
        preparing: true,
        canonicalUrl: '/terms',
      }),
    ).toStrictEqual({
      meta: [
        { title: '利用規約 | Launch Stadium' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      links: [],
    });
  });

  test('取得の失敗でloaderのデータが無ければ、文書の名前のタイトルだけを付ける', () => {
    expect(buildLegalDocumentHead('legal-notice', undefined)).toStrictEqual({
      meta: [{ title: '法的通知 | Launch Stadium' }],
      links: [],
    });
  });
});

describe('buildLegalVersionHead', () => {
  test('過去版は、文書の名前と版番号のタイトルにして検索の索引の対象外にする', () => {
    expect(
      buildLegalVersionHead('legal-notice', { versionNumber: 2 }),
    ).toStrictEqual({
      meta: [
        { title: '法的通知(第2版) | Launch Stadium' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      links: [],
    });
  });

  test('取得の失敗でloaderのデータが無くても、検索の索引の対象外にする', () => {
    expect(buildLegalVersionHead('terms', undefined)).toStrictEqual({
      meta: [
        { title: '利用規約 | Launch Stadium' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      links: [],
    });
  });
});

describe('buildContactHead', () => {
  test('問い合わせのタイトルと、問い合わせのページの正規のURLを付ける', () => {
    expect(buildContactHead()).toStrictEqual({
      meta: [{ title: 'お問い合わせ | Launch Stadium' }],
      links: [{ rel: 'canonical', href: '/contact' }],
    });
  });
});

describe('buildInquiryChatHead', () => {
  test('問い合わせチャットのタイトルを付け、本人だけが読むページのため検索の索引の対象外にする', () => {
    expect(buildInquiryChatHead()).toStrictEqual({
      meta: [
        { title: '問い合わせチャット | Launch Stadium' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      links: [],
    });
  });
});

describe('buildCheckoutHead', () => {
  test('お支払いのタイトルを付け、本人だけが開く決済画面のため検索の索引の対象外にする', () => {
    expect(buildCheckoutHead()).toStrictEqual({
      meta: [
        { title: 'お支払い | Launch Stadium' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      links: [],
    });
  });
});

describe('buildCheckoutReturnHead', () => {
  test('お支払いの結果のタイトルを付け、本人だけが開く決済後のランディングのため検索の索引の対象外にする', () => {
    expect(buildCheckoutReturnHead()).toStrictEqual({
      meta: [
        { title: 'お支払いの結果 | Launch Stadium' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      links: [],
    });
  });
});

describe('buildPublicProfileHead', () => {
  test('タイトルにニックネームと@付きのハンドルを含め、正規のURLを現在のハンドルの表記のパスにする', () => {
    expect(
      buildPublicProfileHead({ handle: 'Maker_AI', nickname: 'AIの作り手' }),
    ).toStrictEqual({
      meta: [{ title: 'AIの作り手(@Maker_AI) | Launch Stadium' }],
      links: [{ rel: 'canonical', href: '/@Maker_AI' }],
    });
  });

  test('取得前や失敗でloaderの値が無いときは、サイト名だけのタイトルにして正規のURLを付けない', () => {
    expect(buildPublicProfileHead(undefined)).toStrictEqual({
      meta: [{ title: 'Launch Stadium' }],
      links: [],
    });
  });
});

describe('buildProductPageHead', () => {
  const LOADER_DATA = {
    handle: 'Pitch-Notes',
    name: 'Pitch Notes',
    tagline: 'ピッチの台本を書いて練習できるノートアプリ',
    listed: true,
  };

  test('タイトルに名称、説明にタグラインを使い、正規のURLを現在のハンドルの表記のパスにする', () => {
    expect(buildProductPageHead(LOADER_DATA)).toStrictEqual({
      meta: [
        { title: 'Pitch Notes | Launch Stadium' },
        {
          name: 'description',
          content: 'ピッチの台本を書いて練習できるノートアプリ',
        },
      ],
      links: [{ rel: 'canonical', href: '/p/Pitch-Notes' }],
    });
  });

  test('未掲載のプロダクト(投稿者本人にだけ表示する)は、検索エンジンの登録を拒否する', () => {
    expect(
      buildProductPageHead({ ...LOADER_DATA, listed: false }).meta,
    ).toContainEqual({ name: 'robots', content: 'noindex, nofollow' });
  });

  test('取得前や失敗でloaderの値が無いときは、サイト名だけのタイトルにして正規のURLを付けない', () => {
    expect(buildProductPageHead(undefined)).toStrictEqual({
      meta: [{ title: 'Launch Stadium' }],
      links: [],
    });
  });
});

describe('buildHelpArticleHead', () => {
  test('タイトルに記事のタイトル、正規のURLに現在のハンドルの表記のパスを出す', () => {
    expect(
      buildHelpArticleHead({ handle: 'Upvote-Rules', title: 'Upvoteのルール' }),
    ).toStrictEqual({
      meta: [{ title: 'Upvoteのルール | Launch Stadium' }],
      links: [{ rel: 'canonical', href: '/help/Upvote-Rules' }],
    });
  });

  test('取得の前や失敗ではサイト名だけにし、正規のURLを付けない', () => {
    expect(buildHelpArticleHead(undefined)).toStrictEqual({
      meta: [{ title: 'Launch Stadium' }],
      links: [],
    });
  });
});
