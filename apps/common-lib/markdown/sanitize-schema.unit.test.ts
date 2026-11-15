import { describe, expect, test } from 'bun:test';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';

import type {
  HastElement,
  HastElementContent,
  HastProperties,
  HastRoot,
} from './hast-types.ts';
import { sanitizeSchemaFor } from './sanitize-schema.ts';

const PREFIX = 'user-content-';

const sanitizer = unified()
  .use(rehypeSanitize, sanitizeSchemaFor(PREFIX))
  .use(rehypeStringify)
  .freeze();

type SanitizableTree = Parameters<typeof sanitizer.runSync>[0];

const element = (
  tagName: string,
  properties: HastProperties,
  ...children: readonly HastElementContent[]
): HastElement => ({ type: 'element', tagName, properties, children });

const text = (value: string): HastElementContent => ({ type: 'text', value });

const sanitizeToHtml = (...children: readonly HastElementContent[]): string => {
  const tree: HastRoot = { type: 'root', children };
  return sanitizer.stringify(
    sanitizer.runSync(tree as unknown as SanitizableTree),
  );
};

describe('sanitizeSchemaFor', () => {
  test.each([
    'h1',
    'img',
    'picture',
    'source',
    'div',
    'span',
    'iframe',
    'details',
    'kbd',
  ])('許可リスト外の%s要素を外して子の文字列だけを残す', (tagName) => {
    expect(sanitizeToHtml(element(tagName, { id: 'x' }, text('子')))).toBe(
      '子',
    );
  });

  test('script要素を子ごと除く', () => {
    expect(sanitizeToHtml(element('script', {}, text('alert(1)')))).toBe('');
  });

  test.each([
    ['p', '<p>a</p>'],
    ['h6', '<h6>a</h6>'],
    ['strong', '<strong>a</strong>'],
    ['blockquote', '<blockquote>a</blockquote>'],
    ['sup', '<sup>a</sup>'],
    ['section', '<section>a</section>'],
  ])('許可した%s要素を残す', (tagName, expected) => {
    expect(sanitizeToHtml(element(tagName, {}, text('a')))).toBe(expected);
  });

  test.each([
    ['style', { style: 'color:red' }],
    ['イベント', { onClick: 'alert(1)' }],
    ['title', { title: 't' }],
    ['src', { src: 'https://img.example/a.png' }],
    ['許可していないclass', { className: ['evil'] }],
  ])('%sの属性を除く', (_, properties) => {
    expect(sanitizeToHtml(element('p', properties, text('a')))).toBe(
      '<p>a</p>',
    );
  });

  test.each([
    ['javascript:', 'javascript:alert(1)'],
    ['大文字のJAVASCRIPT:', 'JAVASCRIPT:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['irc:', 'irc://irc.example/a'],
  ])('%sのhrefを除く', (_, href) => {
    expect(sanitizeToHtml(element('a', { href }, text('a')))).toBe('<a>a</a>');
  });

  test.each([
    'https://site.example/a',
    'http://site.example/a',
    'mailto:user@mail.example',
    '#a',
  ])('許可したスキームと#の参照%sを残す', (href) => {
    expect(sanitizeToHtml(element('a', { href }, text('a')))).toBe(
      `<a href="${href}">a</a>`,
    );
  });

  test('ID・名前・aria-describedby・aria-labelledbyの値に接頭辞を付ける', () => {
    expect(
      sanitizeToHtml(
        element('h2', { id: 'a' }, text('a')),
        element('a', { ariaDescribedBy: ['footnote-label'] }, text('b')),
      ),
    ).toBe(
      '<h2 id="user-content-a">a</h2><a aria-describedby="user-content-footnote-label">b</a>',
    );
  });

  test('本文の識別子を含む接頭辞を付ける', () => {
    const scoped = unified()
      .use(rehypeSanitize, sanitizeSchemaFor('user-content-post1-'))
      .use(rehypeStringify)
      .freeze();
    const tree: HastRoot = {
      type: 'root',
      children: [element('h2', { id: 'a' }, text('a'))],
    };

    expect(
      scoped.stringify(scoped.runSync(tree as unknown as SanitizableTree)),
    ).toBe('<h2 id="user-content-post1-a">a</h2>');
  });

  test.each([
    [
      'コードの言語',
      element('code', { className: ['language-ts'] }, text('a')),
      '<code class="language-ts">a</code>',
    ],
    [
      'タスクリスト',
      element(
        'ul',
        { className: ['contains-task-list'] },
        element(
          'li',
          { className: ['task-list-item'] },
          element('input', { type: 'checkbox', checked: true, disabled: true }),
        ),
      ),
      '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked disabled></li></ul>',
    ],
    [
      '番号付きリストの開始番号',
      element('ol', { start: 3 }, element('li', {}, text('a'))),
      '<ol start="3"><li>a</li></ol>',
    ],
    [
      '表の配置',
      element(
        'table',
        {},
        element(
          'tbody',
          {},
          element('tr', {}, element('td', { align: 'right' }, text('a'))),
        ),
      ),
      '<table><tbody><tr><td align="right">a</td></tr></tbody></table>',
    ],
    [
      '脚注の区画と見出し',
      element(
        'section',
        { dataFootnotes: true, className: ['footnotes'] },
        element(
          'h2',
          { className: ['sr-only'], id: 'footnote-label' },
          text('脚注'),
        ),
      ),
      '<section data-footnotes class="footnotes"><h2 class="sr-only" id="user-content-footnote-label">脚注</h2></section>',
    ],
    [
      '脚注の戻りリンク',
      element(
        'a',
        {
          href: '#fnref-1',
          dataFootnoteBackref: '',
          ariaLabel: '戻る',
          className: ['data-footnote-backref'],
        },
        text('↩'),
      ),
      '<a href="#fnref-1" data-footnote-backref="" aria-label="戻る" class="data-footnote-backref">↩</a>',
    ],
  ])('%sの属性と固定のclassを残す', (_, node, expected) => {
    expect(sanitizeToHtml(node)).toBe(expected);
  });

  test('チェックボックス以外のinputをチェックボックスにして無効にする', () => {
    expect(sanitizeToHtml(element('input', { type: 'text', value: 'x' }))).toBe(
      '<input disabled type="checkbox">',
    );
  });

  test('表の外の行とセルを外す', () => {
    expect(
      sanitizeToHtml(element('tr', {}, element('td', {}, text('a')))),
    ).toBe('a');
  });

  test('呼び出しごとに新しいスキーマを返す', () => {
    expect(sanitizeSchemaFor(PREFIX)).not.toBe(sanitizeSchemaFor(PREFIX));
    expect(sanitizeSchemaFor(PREFIX)).toEqual(sanitizeSchemaFor(PREFIX));
  });
});
