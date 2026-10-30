import { describe, expect, test } from 'bun:test';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';

import type { HastElement, HastRoot } from './hast-types.ts';
import { DEFAULT_ID_PREFIX, idPrefixFor } from './markdown-options.ts';
import { processMarkdown } from './markdown-processor.ts';
import { sanitizeSchemaFor } from './sanitize-schema.ts';

const LONG_RUN_LENGTH = 20_000;

const MAX_ELAPSED_MILLISECONDS = 1_000;

const stringifier = unified().use(rehypeStringify).freeze();

type StringifiableTree = Parameters<typeof stringifier.stringify>[0];

const toHtml = (markdown: string, idPrefix = DEFAULT_ID_PREFIX): string =>
  stringifier.stringify(
    processMarkdown(markdown, idPrefix) as unknown as StringifiableTree,
  );

const elementsOf = (tree: HastRoot): readonly HastElement[] => {
  const elements: HastElement[] = [];
  const pending = [...tree.children];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'element') {
      elements.push(node);
      pending.push(...node.children);
    }
  }
  return elements;
};

const propertyValues = (tree: HastRoot, name: string): readonly string[] =>
  elementsOf(tree).flatMap((element) => {
    const value = element.properties[name];
    if (typeof value === 'string' || typeof value === 'number') {
      return [String(value)];
    }
    return typeof value === 'object' && value !== null ? value.map(String) : [];
  });

const RICH_DOCUMENT = [
  '## 概要 Hello World!',
  '本文[^1]と[^a!b]、[見出しへ](#概要-hello-world!)と[脚注へ](#fn-1)。',
  '### 概要 Hello World!',
  '- [x] 済み\n- [ ] 未着手',
  '3. 三\n4. 四',
  '| 左 | 右 |\n| :- | -: |\n| `a` | **b** |',
  '```ts\nconst a = 1;\n```',
  '> 引用 ~~消す~~ *強調*  \n改行',
  '---',
  '# 題 <script>alert(1)</script> ![a](https://img.example/a.png)',
  '[危険](javascript:alert(1)) [相対](/help) https://site.example',
  '[^1]: 注釈',
  '[^a!b]: 記号の注釈',
].join('\n\n');

describe('processMarkdown', () => {
  describe('GFM', () => {
    test('表を配置の指定とともに変換する', () => {
      const html = toHtml('| 左 | 右 |\n| :- | -: |\n| 1 | 2 |');

      expect(html).toContain('<table>');
      expect(html).toContain('<th align="left">左</th>');
      expect(html).toContain('<td align="right">2</td>');
    });

    test('タスクリストを無効のチェックボックスとして変換する', () => {
      const html = toHtml('- [x] 済み\n- [ ] 未着手');

      expect(html).toContain('<ul class="contains-task-list">');
      expect(html).toContain(
        '<li class="task-list-item"><input type="checkbox" checked disabled> 済み</li>',
      );
      expect(html).toContain(
        '<li class="task-list-item"><input type="checkbox" disabled> 未着手</li>',
      );
    });

    test('取り消し線を変換する', () => {
      expect(toHtml('~~消す~~')).toBe('<p><del>消す</del></p>');
    });

    test.each([
      [
        'URL',
        'https://site.example/a を見る',
        '<p><a href="https://site.example/a">https://site.example/a</a> を見る</p>',
      ],
      [
        'wwwから始まる文字列',
        'www.site.example を見る',
        '<p><a href="http://www.site.example">www.site.example</a> を見る</p>',
      ],
      [
        'メールアドレス',
        'user@mail.example へ',
        '<p><a href="mailto:user@mail.example">user@mail.example</a> へ</p>',
      ],
    ])('%sを自動でリンクにする', (_, markdown, expected) => {
      expect(toHtml(markdown)).toBe(expected);
    });

    test('脚注を参照と定義の組として変換する', () => {
      const html = toHtml('本文[^1]\n\n[^1]: 注釈');

      expect(html).toContain(
        '<sup><a href="#user-content-fn-1" id="user-content-fnref-1" data-footnote-ref aria-describedby="user-content-footnote-label">1</a></sup>',
      );
      expect(html).toContain('<li id="user-content-fn-1">');
      expect(html).toContain('<section data-footnotes class="footnotes">');
    });
  });

  describe('脚注の日本語の文言', () => {
    test('脚注の見出しを視覚的に隠した「脚注」にする', () => {
      expect(toHtml('本文[^1]\n\n[^1]: 注釈')).toContain(
        '<h2 class="sr-only" id="user-content-footnote-label">脚注</h2>',
      );
    });

    test('本文へ戻るリンクの名前を日本語にする', () => {
      expect(toHtml('本文[^1]\n\n[^1]: 注釈')).toContain(
        '<a href="#user-content-fnref-1" data-footnote-backref="" aria-label="本文の参照位置へ戻る" class="data-footnote-backref">↩</a>',
      );
    });
  });

  describe('日本語の句読点に隣接する強調と取り消し線', () => {
    test.each([
      ['太字', '**太字。**の後', '<p><strong>太字。</strong>の後</p>'],
      ['斜体', '*強調。*の後', '<p><em>強調。</em>の後</p>'],
      ['取り消し線', '~~取り消し。~~の後', '<p><del>取り消し。</del>の後</p>'],
      [
        '括弧で終わる太字',
        '**「重要」**です',
        '<p><strong>「重要」</strong>です</p>',
      ],
    ])('句読点で終わる%sを解釈する', (_, markdown, expected) => {
      expect(toHtml(markdown)).toBe(expected);
    });
  });

  describe('Raw HTMLの文字列化', () => {
    test('ブロックのscript要素を段落の中の文字列にする', () => {
      expect(toHtml('<script>alert(1)</script>')).toBe(
        '<p>&#x3C;script>alert(1)&#x3C;/script></p>',
      );
    });

    test('複数行のブロックのRaw HTMLを改行を含む1つの段落にする', () => {
      expect(toHtml('<div>\n*強調ではない*\n</div>')).toBe(
        '<p>&#x3C;div>\n*強調ではない*\n&#x3C;/div></p>',
      );
    });

    test('インラインのRaw HTMLを段落の中の文字列にする', () => {
      expect(toHtml('a <b onclick="x()">太字</b> c')).toBe(
        '<p>a &#x3C;b onclick="x()">太字&#x3C;/b> c</p>',
      );
    });

    test('HTMLのコメントを文字列にする', () => {
      expect(toHtml('<!-- メモ -->')).toBe('<p>&#x3C;!-- メモ --></p>');
    });

    test.each([
      [
        '引用',
        '> <div>x</div>',
        '<blockquote>\n<p>&#x3C;div>x&#x3C;/div></p>\n</blockquote>',
      ],
      [
        'リストの項目',
        '- a\n\n  <div>x</div>',
        '<ul>\n<li>\n<p>a</p>\n<p>&#x3C;div>x&#x3C;/div></p>\n</li>\n</ul>',
      ],
    ])('%sの中のブロックのRaw HTMLを段落にする', (_, markdown, expected) => {
      expect(toHtml(markdown)).toBe(expected);
    });

    test('脚注の定義の中のブロックのRaw HTMLを段落にする', () => {
      expect(toHtml('本文[^1]\n\n[^1]: 注釈\n\n    <div>x</div>')).toContain(
        '<p>注釈</p>\n<p>&#x3C;div>x&#x3C;/div> <a href="#user-content-fnref-1"',
      );
    });

    test('表のセルの中のRaw HTMLを段落で包まずに文字列にする', () => {
      expect(toHtml('| a |\n| - |\n| <b>x</b> |')).toContain(
        '<td>&#x3C;b>x&#x3C;/b></td>',
      );
    });
  });

  describe('見出しレベル1の段落化', () => {
    test.each([
      ['ATX形式', '# タイトル', '<p># タイトル</p>'],
      ['Setext形式', 'タイトル\n===', '<p># タイトル</p>'],
      ['書式を含む', '# **太字**の題', '<p># <strong>太字</strong>の題</p>'],
      [
        '引用の中',
        '> # タイトル',
        '<blockquote>\n<p># タイトル</p>\n</blockquote>',
      ],
    ])('%sの見出しレベル1を「# 」付きの段落にする', (_, markdown, expected) => {
      expect(toHtml(markdown)).toBe(expected);
    });

    test('見出しレベル2〜6は見出しのまま残す', () => {
      expect(toHtml('## 二\n\n###### 六')).toBe(
        '<h2 id="user-content-%E4%BA%8C">二</h2>\n<h6 id="user-content-%E5%85%AD">六</h6>',
      );
    });
  });

  describe('画像の文字列化', () => {
    test.each([
      [
        'インライン形式',
        '![代替テキスト](https://img.example/a.png)',
        '<p>![代替テキスト](https://img.example/a.png)</p>',
      ],
      [
        'タイトル付きのインライン形式',
        '![図](https://img.example/a.png "題")',
        '<p>![図](https://img.example/a.png)</p>',
      ],
      [
        '完全な参照形式',
        '![図][Logo]\n\n[logo]: https://img.example/a.png',
        '<p>![図][Logo]</p>',
      ],
      [
        '省略した参照形式',
        '![Logo][]\n\n[logo]: https://img.example/a.png',
        '<p>![Logo][]</p>',
      ],
      [
        '短縮した参照形式',
        '![Logo]\n\n[logo]: https://img.example/a.png',
        '<p>![Logo]</p>',
      ],
      [
        'リンクの中',
        '[![図](https://img.example/a.png)](https://site.example)',
        '<p><a href="https://site.example">![図](https://img.example/a.png)</a></p>',
      ],
    ])('%sの画像を文字列にする', (_, markdown, expected) => {
      expect(toHtml(markdown)).toBe(expected);
    });
  });

  test('Raw HTML・見出しレベル1・画像を含む入力からscript・img・h1の要素を出力しない', () => {
    const html = toHtml(
      [
        '# 題',
        '<script>alert(1)</script>',
        '<img src="x" onerror="alert(1)">',
        '![a](javascript:alert(1))',
        '- <iframe src="https://evil.example"></iframe>',
      ].join('\n\n'),
    );

    expect(html).not.toMatch(/<(?:script|img|h1|iframe)\b/u);
  });

  test('同じ入力から同じ木を返す', () => {
    expect(processMarkdown(RICH_DOCUMENT, DEFAULT_ID_PREFIX)).toEqual(
      processMarkdown(RICH_DOCUMENT, DEFAULT_ID_PREFIX),
    );
  });

  describe('見出しのID', () => {
    test('見出しレベル2〜6に見出しの文字列の変換と接頭辞のIDを付ける', () => {
      expect(toHtml('## 概要 Hello World!')).toBe(
        '<h2 id="user-content-%E6%A6%82%E8%A6%81-hello-world%21">概要 Hello World!</h2>',
      );
    });

    test('同じIDの見出しに連番を付ける', () => {
      expect(toHtml('## A\n\n### a\n\n#### A')).toBe(
        '<h2 id="user-content-a">A</h2>\n<h3 id="user-content-a-1">a</h3>\n<h4 id="user-content-a-2">A</h4>',
      );
    });

    test('脚注のIDと重なる見出しに連番を付ける', () => {
      const html = toHtml(
        '## fn-1\n\n## footnote label\n\n本文[^1]\n\n[^1]: 注釈',
      );

      expect(html).toContain('<h2 id="user-content-fn-1-1">fn-1</h2>');
      expect(html).toContain(
        '<h2 id="user-content-footnote-label-1">footnote label</h2>',
      );
      expect(html).toContain('<li id="user-content-fn-1">');
      expect(html).toContain('id="user-content-footnote-label">脚注</h2>');
    });

    test('空の見出しに既定の変換結果のIDを付ける', () => {
      expect(toHtml('##')).toBe('<h2 id="user-content-heading"></h2>');
    });
  });

  describe('接頭辞', () => {
    test('脚注を含む本文由来の全てのIDと参照するIDが接頭辞で始まる', () => {
      const tree = processMarkdown(RICH_DOCUMENT, DEFAULT_ID_PREFIX);
      const ids = [
        ...propertyValues(tree, 'id'),
        ...propertyValues(tree, 'ariaDescribedBy'),
        ...propertyValues(tree, 'ariaLabelledBy'),
        ...propertyValues(tree, 'name'),
      ];

      expect(ids.length).toBeGreaterThan(8);
      expect(ids.filter((id) => !id.startsWith(DEFAULT_ID_PREFIX))).toEqual([]);
    });

    test('本文の識別子を含む接頭辞を全てのIDと#の参照に付ける', () => {
      const prefix = idPrefixFor('post1');
      const tree = processMarkdown(RICH_DOCUMENT, prefix);
      const ids = propertyValues(tree, 'id');
      const anchors = propertyValues(tree, 'href').filter((href) =>
        href.startsWith('#'),
      );

      expect(ids.filter((id) => !id.startsWith(prefix))).toEqual([]);
      expect(anchors.length).toBeGreaterThan(4);
      expect(anchors.filter((href) => !href.startsWith(`#${prefix}`))).toEqual(
        [],
      );
    });

    test('全ての#の参照が同じ本文のIDを指す', () => {
      const tree = processMarkdown(RICH_DOCUMENT, DEFAULT_ID_PREFIX);
      const ids = new Set(propertyValues(tree, 'id'));
      const targets = propertyValues(tree, 'href')
        .filter((href) => href.startsWith('#'))
        .map((href) => href.slice(1));

      expect(targets.filter((target) => !ids.has(target))).toEqual([]);
    });
  });

  describe('#の参照', () => {
    test.each([
      [
        '見出しの文字列',
        '[x](#概要-hello-world!)',
        '#user-content-%E6%A6%82%E8%A6%81-hello-world%21',
      ],
      [
        'エンコード済みの値',
        '[x](#%E6%A6%82%E8%A6%81)',
        '#user-content-%E6%A6%82%E8%A6%81',
      ],
      ['大文字の英字', '[x](#Section)', '#user-content-section'],
      [
        'デコードできない値',
        '[x](#%E0%A4%A)',
        '#user-content-%25e0%25a4%2525a',
      ],
    ])(
      '%sの参照を見出しのIDと同じ変換と接頭辞で書き換える',
      (_, markdown, href) => {
        expect(toHtml(markdown)).toBe(`<p><a href="${href}">x</a></p>`);
      },
    );

    test('!を含む脚注のIDと参照と戻りリンクを同じ変換でそろえる', () => {
      const html = toHtml('本文[^a!b]\n\n[^a!b]: 注釈');

      expect(html).toContain(
        '<a href="#user-content-fn-a%21b" id="user-content-fnref-a%21b"',
      );
      expect(html).toContain('<li id="user-content-fn-a%21b">');
      expect(html).toContain('<a href="#user-content-fnref-a%21b"');
    });

    test('CJK文字の脚注のIDと参照をそろえる', () => {
      const html = toHtml('本文[^注]\n\n[^注]: 注釈');

      expect(html).toContain('<a href="#user-content-fn-%E6%B3%A8"');
      expect(html).toContain('<li id="user-content-fn-%E6%B3%A8">');
    });

    test('フラグメントが空の#の参照は書き換えない', () => {
      expect(toHtml('[先頭へ](#)')).toBe('<p><a href="#">先頭へ</a></p>');
    });

    test('#から始まらない参照は書き換えない', () => {
      expect(toHtml('[x](https://site.example/#a)')).toBe(
        '<p><a href="https://site.example/#a">x</a></p>',
      );
    });
  });

  describe('サニタイズ', () => {
    test('出力の木に許可リスト外の要素と属性が無い', () => {
      const schema = sanitizeSchemaFor(DEFAULT_ID_PREFIX);
      const allowedTags = new Set(schema.tagNames);
      const allowedAttributes = (tagName: string): ReadonlySet<string> =>
        new Set(
          (schema.attributes?.[tagName] ?? []).map((definition) =>
            typeof definition === 'string' ? definition : definition[0],
          ),
        );
      const elements = elementsOf(
        processMarkdown(RICH_DOCUMENT, DEFAULT_ID_PREFIX),
      );

      expect(
        elements.filter((element) => !allowedTags.has(element.tagName)),
      ).toEqual([]);
      expect(
        elements.flatMap((element) =>
          Object.keys(element.properties)
            .filter((name) => !allowedAttributes(element.tagName).has(name))
            .map((name) => `${element.tagName}.${name}`),
        ),
      ).toEqual([]);
    });

    test('許可していないスキームのリンクから参照先を除く', () => {
      expect(toHtml('[x](javascript:alert(1)) [y](data:text/html,a)')).toBe(
        '<p><a>x</a> <a>y</a></p>',
      );
    });

    test('リンクのtitleを出力しない', () => {
      expect(toHtml('[x](https://site.example "題")')).toBe(
        '<p><a href="https://site.example">x</a></p>',
      );
    });

    test('番号付きリストの開始番号を残す', () => {
      expect(toHtml('3. 三')).toBe('<ol start="3">\n<li>三</li>\n</ol>');
    });

    test('コードブロックの言語のclassを残す', () => {
      expect(toHtml('```ts\na\n```')).toBe(
        '<pre><code class="language-ts">a\n</code></pre>',
      );
    });
  });

  describe('入れ子の深さの上限', () => {
    test('最も深い節点の深さが100以内の文書を通常どおり変換する', () => {
      const html = toHtml(`${'>'.repeat(98)} 最深`);

      expect(html.match(/<blockquote>/gu)).toHaveLength(98);
      expect(html).toContain('<p>最深</p>');
    });

    test('最も深い節点の深さが100を超える文書を原文の文字列だけの段落にする', () => {
      const markdown = `${'>'.repeat(99)} **最深** <b>x</b>`;

      expect(toHtml(markdown)).toBe(
        `<p>${'>'.repeat(99)} **最深** &#x3C;b>x&#x3C;/b></p>`,
      );
    });

    test('深さの上限を超えた文書の原文のURLをリンクにしない', () => {
      expect(toHtml(`${'>'.repeat(99)} https://site.example`)).toBe(
        `<p>${'>'.repeat(99)} https://site.example</p>`,
      );
    });
  });

  test(`同じ見出しが続く${LONG_RUN_LENGTH.toLocaleString('en-US')}文字の入力を線形の時間で処理する`, () => {
    const repeated = '## a\n\n[x](#a)\n\n';
    const count = Math.floor(LONG_RUN_LENGTH / repeated.length);

    const startedAt = performance.now();
    const html = toHtml(repeated.repeat(count));
    const elapsed = performance.now() - startedAt;

    expect(html).toContain(`id="user-content-a-${String(count - 1)}"`);
    expect(elapsed).toBeLessThan(MAX_ELAPSED_MILLISECONDS);
  });
});
