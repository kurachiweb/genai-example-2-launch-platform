import type { MarkdownHeading } from '../extract-headings.ts';
import type { MarkdownRenderOptions } from '../markdown-options.ts';
import type { HighlightRange } from '../../search/highlight-ranges.ts';
import { REPRESENTATIVE_MARKDOWN } from './representative-markdown.ts';
import { XSS_PAYLOADS } from './xss-payloads.ts';

// 共用部品が実行する場所(Bun・ブラウザ・Workers)によらず同じ結果を返すことを、同じ標本で照合する。期待値はBunで求めた値である。
// 標本を足すときや、共用部品の処理を変えて結果が変わるときは、入力をこのファイルに書き、`apps/common-lib`で`bun test --config=../../bunfig.toml cross-runtime-samples`を実行して、失敗の差分の受け取った値(Received)で期待値を書き換える。
// その後、ブラウザテスト(`apps/frontend-lib`の`config/cross-runtime-samples.browser.test.ts`)とWorkers統合テスト(`apps/api`の`test/cross-runtime/cross-runtime-samples.worker.test.ts`)を実行し、同じ期待値で通ることを確かめる。

export interface CrossRuntimeMarkdownResults {
  readonly html: string;
  readonly headings: readonly MarkdownHeading[];
  readonly plainText: string;
  readonly searchText: string;
  readonly graphemes: number;
}

export interface CrossRuntimeTextResults {
  readonly graphemes: number;
  readonly indexText: string;
  readonly searchTerms: readonly string[];
}

export interface CrossRuntimeMarkdownSample {
  readonly name: string;
  readonly markdown: string;
  readonly expected: CrossRuntimeMarkdownResults;
}

export interface CrossRuntimeDigestSample {
  readonly name: string;
  readonly markdowns: readonly string[];
  readonly sha256: string;
}

export interface CrossRuntimeTextSample {
  readonly name: string;
  readonly text: string;
  readonly expected: CrossRuntimeTextResults;
}

export interface CrossRuntimeHighlightSample {
  readonly name: string;
  readonly text: string;
  readonly terms: readonly string[];
  readonly expected: readonly HighlightRange[];
}

export const CROSS_RUNTIME_RENDER_OPTIONS: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'noreferrer', 'nofollow', 'ugc'],
};

export const CROSS_RUNTIME_MARKDOWN_SAMPLES: readonly CrossRuntimeMarkdownSample[] =
  [
    {
      name: '絵文字を含む見出しと本文',
      markdown:
        '## 🦄Unicorn ✨リリース\n\n家族👨‍👩‍👧‍👦と🇯🇵Japan、肌色👍🏽、キーキャップ1️⃣、旗🏴󠁧󠁢󠁳󠁣󠁴󠁿、新しい絵文字🫨🐦‍🔥🙂‍↔️',
      expected: {
        html: '<h2 id="user-content-%F0%9F%A6%84unicorn-%E2%9C%A8%E3%83%AA%E3%83%AA%E3%83%BC%E3%82%B9">🦄Unicorn ✨リリース</h2>\n<p>家族👨‍👩‍👧‍👦と🇯🇵Japan、肌色👍🏽、キーキャップ1️⃣、旗🏴󠁧󠁢󠁳󠁣󠁴󠁿、新しい絵文字🫨🐦‍🔥🙂‍↔️</p>',
        headings: [
          {
            depth: 2,
            id: 'user-content-%F0%9F%A6%84unicorn-%E2%9C%A8%E3%83%AA%E3%83%AA%E3%83%BC%E3%82%B9',
            text: '🦄Unicorn ✨リリース',
          },
        ],
        plainText:
          '🦄Unicorn ✨リリース\n\n家族👨‍👩‍👧‍👦と🇯🇵Japan、肌色👍🏽、キーキャップ1️⃣、旗🏴󠁧󠁢󠁳󠁣󠁴󠁿、新しい絵文字🫨🐦‍🔥🙂‍↔️',
        searchText:
          '🦄Unicorn ✨リリース\n\n家族👨‍👩‍👧‍👦と🇯🇵Japan、肌色👍🏽、キーキャップ1️⃣、旗🏴󠁧󠁢󠁳󠁣󠁴󠁿、新しい絵文字🫨🐦‍🔥🙂‍↔️',
        graphemes: 54,
      },
    },
    {
      name: '結合文字とCRLF',
      markdown:
        '### Cafe\u0301 か\u3099\r\n\r\nहिन्दी e\u0301\u0301clair\r\n\r\n- 項目\r\n- [x] 完了\r\n',
      expected: {
        html: '<h3 id="user-content-cafe%CC%81-%E3%81%8B%E3%82%99">Cafe\u0301 か\u3099</h3>\n<p>हिन्दी e\u0301\u0301clair</p>\n<ul class="contains-task-list">\n<li>項目</li>\n<li class="task-list-item"><input type="checkbox" checked disabled aria-label="完了"> 完了</li>\n</ul>',
        headings: [
          {
            depth: 3,
            id: 'user-content-cafe%CC%81-%E3%81%8B%E3%82%99',
            text: 'Cafe\u0301 か\u3099',
          },
        ],
        plainText:
          'Cafe\u0301 か\u3099\n\nहिन्दी e\u0301\u0301clair\n\n項目\n 完了',
        searchText:
          'Cafe\u0301 か\u3099\n\nहिन्दी e\u0301\u0301clair\n\n項目\n 完了',
        graphemes: 37,
      },
    },
    {
      name: '半角カナと合字',
      markdown: '### ﾀｽｸｶﾞﾝﾘ\n\nﬁle ﬀ ①② ㍿ **ﾃｽﾄ。**の後',
      expected: {
        html: '<h3 id="user-content-%EF%BE%80%EF%BD%BD%EF%BD%B8%EF%BD%B6%EF%BE%9E%EF%BE%9D%EF%BE%98">ﾀｽｸｶﾞﾝﾘ</h3>\n<p>ﬁle ﬀ ①② ㍿ <strong>ﾃｽﾄ。</strong>の後</p>',
        headings: [
          {
            depth: 3,
            id: 'user-content-%EF%BE%80%EF%BD%BD%EF%BD%B8%EF%BD%B6%EF%BE%9E%EF%BE%9D%EF%BE%98',
            text: 'ﾀｽｸｶﾞﾝﾘ',
          },
        ],
        plainText: 'ﾀｽｸｶﾞﾝﾘ\n\nﬁle ﬀ ①② ㍿ ﾃｽﾄ。の後',
        searchText: 'ﾀｽｸｶﾞﾝﾘ\n\nﬁle ﬀ ①② ㍿ ﾃｽﾄ。の後',
        graphemes: 33,
      },
    },
    {
      name: '表と脚注とリンク',
      markdown:
        '| 列 | 値 |\n| :- | -: |\n| [外部](https://other.example) | [内部](/help) |\n\n本文[^1]と<https://client.example/a>、[見出しへ](#使い方)\n\n## 使い方\n\n[^1]: 注釈',
      expected: {
        html: '<div class="markdown-table-scroll" tabindex="0" role="region" aria-label="表(横にスクロールできます)"><table>\n<thead>\n<tr>\n<th align="left">列</th>\n<th align="right">値</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align="left"><a href="https://other.example" target="_blank" rel="noopener noreferrer nofollow ugc">外部</a></td>\n<td align="right">内部</td>\n</tr>\n</tbody>\n</table></div>\n<p>本文<sup><a href="#user-content-fn-1" id="user-content-fnref-1" data-footnote-ref aria-describedby="user-content-footnote-label">1</a></sup>と<a href="https://client.example/a">https://client.example/a</a>、<a href="#user-content-%E4%BD%BF%E3%81%84%E6%96%B9">見出しへ</a></p>\n<h2 id="user-content-%E4%BD%BF%E3%81%84%E6%96%B9">使い方</h2>\n<section data-footnotes class="footnotes"><h2 class="sr-only" id="user-content-footnote-label">脚注</h2>\n<ol>\n<li id="user-content-fn-1">\n<p>注釈 <a href="#user-content-fnref-1" data-footnote-backref="" aria-label="本文の参照位置へ戻る" class="data-footnote-backref">↩</a></p>\n</li>\n</ol>\n</section>',
        headings: [
          {
            depth: 2,
            id: 'user-content-%E4%BD%BF%E3%81%84%E6%96%B9',
            text: '使い方',
          },
        ],
        plainText:
          '列\t 値 外部\t 内部\n\n本文1とhttps://client.example/a、見出しへ\n\n使い方\n\n注釈',
        searchText:
          '列\t 値 外部\t 内部\n\n本文1とhttps://client.example/a、見出しへ\n\n使い方\n\n注釈',
        graphemes: 133,
      },
    },
    {
      name: '攻撃パターン(スクリプト)',
      markdown: '<script>alert(1)</script>',
      expected: {
        html: '<p>&#x3C;script>alert(1)&#x3C;/script></p>',
        headings: [],
        plainText: '<script>alert(1)</script>',
        searchText: '<script>alert(1)</script>',
        graphemes: 25,
      },
    },
    {
      name: '攻撃パターン(イベント属性)',
      markdown: '<img src=x onerror=alert(1)>',
      expected: {
        html: '<p>&#x3C;img src=x onerror=alert(1)></p>',
        headings: [],
        plainText: '<img src=x onerror=alert(1)>',
        searchText: '<img src=x onerror=alert(1)>',
        graphemes: 28,
      },
    },
    {
      name: '攻撃パターン(危険なスキーム)',
      markdown: '[x](javascript:alert(1))',
      expected: {
        html: '<p>x</p>',
        headings: [],
        plainText: 'x',
        searchText: 'x',
        graphemes: 24,
      },
    },
    {
      name: '攻撃パターン(全角の危険なスキーム)',
      markdown: '[x](ｊａｖａｓｃｒｉｐｔ:alert(1))',
      expected: {
        html: '<p>x</p>',
        headings: [],
        plainText: 'x',
        searchText: 'x',
        graphemes: 24,
      },
    },
    {
      name: '攻撃パターン(参照形式のリンク)',
      markdown: '[x][a]\n\n[a]: javascript:alert(1)',
      expected: {
        html: '<p>x</p>',
        headings: [],
        plainText: 'x',
        searchText: 'x',
        graphemes: 32,
      },
    },
    {
      name: '攻撃パターン(自動リンク)',
      markdown: 'www.evil.example/"onmouseover="alert(1)',
      expected: {
        html: '<p><a href="http://www.evil.example/%22onmouseover=%22alert(1)" target="_blank" rel="noopener noreferrer nofollow ugc">www.evil.example/"onmouseover="alert(1)</a></p>',
        headings: [],
        plainText: 'www.evil.example/"onmouseover="alert(1)',
        searchText: 'www.evil.example/"onmouseover="alert(1)',
        graphemes: 39,
      },
    },
    {
      name: '攻撃パターン(IDによる上書き)',
      markdown: '## __proto__',
      expected: {
        html: '<h2 id="user-content-proto"><strong>proto</strong></h2>',
        headings: [
          {
            depth: 2,
            id: 'user-content-proto',
            text: 'proto',
          },
        ],
        plainText: 'proto',
        searchText: 'proto',
        graphemes: 12,
      },
    },
  ];

// 結果が大きい文書の期待値は、各文書の結果の配列のJSONのSHA-256の16進である
export const CROSS_RUNTIME_DIGEST_SAMPLES: readonly CrossRuntimeDigestSample[] =
  [
    {
      name: '代表的な文書',
      markdowns: [REPRESENTATIVE_MARKDOWN],
      sha256:
        'ca94179ceefbfcda4f913b34923eab2f2e3fbfe492cbc4b178a60bccd9819ac3',
    },
    {
      name: '攻撃パターン集の全件',
      markdowns: XSS_PAYLOADS.map(({ markdown }) => markdown),
      sha256:
        '51feb6e3f2f7cce48eb81512d1478358c0eac363c2ed254de2815361f9c320c5',
    },
  ];

export const CROSS_RUNTIME_TEXT_SAMPLES: readonly CrossRuntimeTextSample[] = [
  {
    name: 'Unicode 6.1より後の絵文字',
    text: '🦄Unicorn🤣',
    expected: {
      graphemes: 9,
      indexText: 'Unicorn',
      searchTerms: ['Unicorn'],
    },
  },
  {
    name: 'ゼロ幅接合子・肌色の修飾・国旗・タグ文字',
    text: '👨‍👩‍👧‍👦家族 👍🏽 🇯🇵 🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    expected: {
      graphemes: 9,
      indexText: '家族',
      searchTerms: ['家族'],
    },
  },
  {
    name: 'キーキャップと異体字セレクタ',
    text: '1️⃣#️⃣*️⃣ ❤️❤︎',
    expected: {
      graphemes: 6,
      indexText: '1 # *',
      searchTerms: ['1', '#', '*'],
    },
  },
  {
    name: '新しい絵文字',
    text: '🫨🐦‍🔥🙂‍↔️🫩a',
    expected: {
      graphemes: 5,
      indexText: 'a',
      searchTerms: ['a'],
    },
  },
  {
    name: '互換分解で文字になる絵文字と日本語の記号',
    text: '™ℹⓂ㊗🈂️ 〇〒〆々〰〽',
    expected: {
      graphemes: 12,
      indexText: 'TMiM祝サ 〇〒〆々',
      searchTerms: ['TMiM祝サ', '〇〒〆々'],
    },
  },
  {
    name: '結合文字',
    text: 'Cafe\u0301 か\u3099 हिन्दी e\u0301\u0301',
    expected: {
      graphemes: 11,
      indexText: 'Café が हिन्दी é\u0301',
      searchTerms: ['Café', 'が', 'हिन्दी', 'é\u0301'],
    },
  },
  {
    name: 'CRLFと空白',
    text: ' タスク\r\n管理\u3000\u0085ツール\ufeff\u00a0',
    expected: {
      graphemes: 14,
      indexText: 'タスク 管理 ツール\ufeff',
      searchTerms: ['タスク', '管理', 'ツール\ufeff'],
    },
  },
  {
    name: '半角カナ',
    text: 'ﾀｽｸｶﾞﾝﾘ ﾊﾟﾝ',
    expected: {
      graphemes: 9,
      indexText: 'タスクガンリ パン',
      searchTerms: ['タスクガンリ', 'パン'],
    },
  },
  {
    name: '合字と丸付き数字',
    text: 'ﬁle ﬀ ①② ㍿',
    expected: {
      graphemes: 10,
      indexText: 'file ff 12 株式会社',
      searchTerms: ['file', 'ff', '12', '株式会社'],
    },
  },
];

export const CROSS_RUNTIME_HIGHLIGHT_SAMPLES: readonly CrossRuntimeHighlightSample[] =
  [
    {
      name: '絵文字の後の語',
      text: '🦄Unicorn ✨リリース',
      terms: ['unicorn', 'リリ'],
      expected: [
        {
          start: 2,
          end: 9,
        },
        {
          start: 11,
          end: 13,
        },
      ],
    },
    {
      name: '肌色の修飾と発音区別符号',
      text: 'Café👍🏽Olé',
      terms: ['cafe', 'OLE'],
      expected: [
        {
          start: 0,
          end: 4,
        },
        {
          start: 8,
          end: 11,
        },
      ],
    },
    {
      name: '半角カナと合字と丸付き数字',
      text: 'ﾀｽｸｶﾞﾝﾘ ﬁle ①番',
      terms: ['タスク', 'file', '1番'],
      expected: [
        {
          start: 0,
          end: 3,
        },
        {
          start: 8,
          end: 11,
        },
        {
          start: 12,
          end: 14,
        },
      ],
    },
    {
      name: 'キーキャップと互換分解で文字になる絵文字',
      text: '1️⃣2️⃣ 🈂️の案内',
      terms: ['1', 'サ'],
      expected: [
        {
          start: 0,
          end: 3,
        },
        {
          start: 7,
          end: 10,
        },
      ],
    },
    {
      name: '結合文字とCRLF',
      text: 'e\u0301clair Việt\r\nNam',
      terms: ['e', 'viet', 'nam'],
      expected: [
        {
          start: 0,
          end: 2,
        },
        {
          start: 8,
          end: 12,
        },
        {
          start: 14,
          end: 17,
        },
      ],
    },
    {
      name: 'ゼロ幅接合子と国旗',
      text: '👨‍👩‍👧‍👦家族 🇯🇵Japan',
      terms: ['家族', 'japan', '🇯🇵'],
      expected: [
        {
          start: 11,
          end: 13,
        },
        {
          start: 18,
          end: 23,
        },
      ],
    },
  ];
