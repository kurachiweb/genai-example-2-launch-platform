import { describe, expect, test } from 'bun:test';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';

import { markdownToHast } from './markdown-processor.ts';

const stringifier = unified().use(rehypeStringify).freeze();

type StringifiableTree = Parameters<typeof stringifier.stringify>[0];

// サニタイズの前の段階の木を、出力の確かめやすいHTMLの文字列にして比べる
const toHtml = (markdown: string): string =>
  stringifier.stringify(
    markdownToHast(markdown) as unknown as StringifiableTree,
  );

describe('markdownToHast', () => {
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
        '<sup><a href="#fn-1" id="fnref-1" data-footnote-ref aria-describedby="footnote-label">1</a></sup>',
      );
      expect(html).toContain('<li id="fn-1">');
      expect(html).toContain('<section data-footnotes class="footnotes">');
    });
  });

  describe('脚注の日本語の文言', () => {
    test('脚注の見出しを視覚的に隠した「脚注」にする', () => {
      expect(toHtml('本文[^1]\n\n[^1]: 注釈')).toContain(
        '<h2 class="sr-only" id="footnote-label">脚注</h2>',
      );
    });

    test('本文へ戻るリンクの名前を日本語にする', () => {
      expect(toHtml('本文[^1]\n\n[^1]: 注釈')).toContain(
        '<a href="#fnref-1" data-footnote-backref="" aria-label="本文の参照位置へ戻る" class="data-footnote-backref">↩</a>',
      );
    });

    test('脚注のIDと参照にこの段階では接頭辞を付けない', () => {
      expect(toHtml('本文[^1]\n\n[^1]: 注釈')).not.toContain('user-content-');
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
        '<p>注釈</p>\n<p>&#x3C;div>x&#x3C;/div> <a href="#fnref-1"',
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
      expect(toHtml('## 二\n\n###### 六')).toBe('<h2>二</h2>\n<h6>六</h6>');
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
    const markdown = '# 題\n\n本文[^1] <b>x</b> ![a](b)\n\n[^1]: 注釈';

    expect(markdownToHast(markdown)).toEqual(markdownToHast(markdown));
  });
});
