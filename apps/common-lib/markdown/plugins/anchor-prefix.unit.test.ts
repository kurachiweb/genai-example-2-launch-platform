import { describe, expect, test } from 'bun:test';

import type {
  HastElement,
  HastElementContent,
  HastProperties,
  HastRoot,
} from '../hast-types.ts';
import { prefixAnchors } from './anchor-prefix.ts';

const PREFIX = 'user-content-';

const LONG_RUN_LENGTH = 5_000;

const MAX_ELAPSED_MILLISECONDS = 200;

const root = (...children: readonly HastElementContent[]): HastRoot => ({
  type: 'root',
  children,
});

const element = (
  tagName: string,
  properties: HastProperties,
  ...children: readonly HastElementContent[]
): HastElement => ({ type: 'element', tagName, properties, children });

const link = (href: string): HastElement =>
  element('a', { href }, { type: 'text', value: 'x' });

const hrefsOf = (tree: HastRoot): readonly unknown[] =>
  tree.children.flatMap((child) =>
    child.type === 'element' ? [child.properties['href']] : [],
  );

describe('prefixAnchors', () => {
  test.each([
    [
      '見出しの文字列',
      '#概要-hello-world!',
      '#user-content-%E6%A6%82%E8%A6%81-hello-world%21',
    ],
    [
      'エンコード済みの値',
      '#%E6%A6%82%E8%A6%81',
      '#user-content-%E6%A6%82%E8%A6%81',
    ],
    ['大文字の英字', '#Section', '#user-content-section'],
    ['デコードできない値', '#%E0%A4%A', '#user-content-%25e0%25a4%25a'],
    ['脚注の参照', '#fn-1', '#user-content-fn-1'],
    ['記号を含む脚注の参照', '#fn-a!b', '#user-content-fn-a%21b'],
  ])('%sの#の参照を正規化して接頭辞を付ける', (_, href, expected) => {
    expect(hrefsOf(prefixAnchors(root(link(href)), PREFIX))).toEqual([
      expected,
    ]);
  });

  test('本文の識別子を含む接頭辞を付ける', () => {
    expect(
      hrefsOf(prefixAnchors(root(link('#a')), 'user-content-post1-')),
    ).toEqual(['#user-content-post1-a']);
  });

  test('フラグメントが空の#の参照は書き換えない', () => {
    expect(hrefsOf(prefixAnchors(root(link('#')), PREFIX))).toEqual(['#']);
  });

  test.each(['https://site.example/#a', 'mailto:user@mail.example', '/help#a'])(
    '#から始まらない参照%sを書き換えない',
    (href) => {
      expect(hrefsOf(prefixAnchors(root(link(href)), PREFIX))).toEqual([href]);
    },
  );

  test('a要素以外のhrefと参照の無いa要素を書き換えない', () => {
    const tree = root(element('area', { href: '#a' }), element('a', {}));

    expect(prefixAnchors(tree, PREFIX)).toEqual(tree);
  });

  test('入れ子の要素の中の参照も書き換える', () => {
    const tree = root(element('p', {}, element('sup', {}, link('#fn-1'))));

    expect(prefixAnchors(tree, PREFIX)).toEqual(
      root(element('p', {}, element('sup', {}, link('#user-content-fn-1')))),
    );
  });

  test('入力の木を書き換えない', () => {
    const tree = root(link('#a'));
    const snapshot = structuredClone(tree);

    prefixAnchors(tree, PREFIX);

    expect(tree).toEqual(snapshot);
  });

  test(`${LONG_RUN_LENGTH.toLocaleString('en-US')}個の参照を線形の時間で書き換える`, () => {
    const tree = root(
      ...Array.from({ length: LONG_RUN_LENGTH }, () => link('#a')),
    );

    const startedAt = performance.now();
    const result = prefixAnchors(tree, PREFIX);
    const elapsed = performance.now() - startedAt;

    expect(hrefsOf(result).at(-1)).toBe('#user-content-a');
    expect(elapsed).toBeLessThan(MAX_ELAPSED_MILLISECONDS);
  });
});
