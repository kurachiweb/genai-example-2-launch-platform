import { describe, expect, test } from 'bun:test';

import type {
  HastElement,
  HastElementContent,
  HastProperties,
  HastRoot,
} from '../hast-types.ts';
import { assignHeadingIds } from './heading-ids.ts';

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

const text = (value: string): HastElementContent => ({ type: 'text', value });

const heading = (tagName: string, value: string): HastElement =>
  element(tagName, {}, text(value));

const idsOf = (tree: HastRoot): readonly unknown[] =>
  tree.children.flatMap((child) =>
    child.type === 'element' ? [child.properties['id']] : [],
  );

describe('assignHeadingIds', () => {
  test.each(['h2', 'h3', 'h4', 'h5', 'h6'])(
    '%sに見出しの文字列のスラッグをIDとして付ける',
    (tagName) => {
      expect(
        idsOf(assignHeadingIds(root(heading(tagName, '概要 Hello World!')))),
      ).toEqual(['%E6%A6%82%E8%A6%81-hello-world%21']);
    },
  );

  test('h1と見出しでない要素にIDを付けない', () => {
    expect(
      idsOf(assignHeadingIds(root(heading('h1', 'a'), heading('p', 'b')))),
    ).toEqual([undefined, undefined]);
  });

  test('書式を含む見出しの文字列全体からスラッグを作る', () => {
    const tree = root(
      element(
        'h2',
        {},
        text('A '),
        element('strong', {}, text('B')),
        text(' c'),
      ),
    );

    expect(idsOf(assignHeadingIds(tree))).toEqual(['a-b-c']);
  });

  test('空の見出しに既定のスラッグを付ける', () => {
    expect(idsOf(assignHeadingIds(root(element('h2', {}))))).toEqual([
      'heading',
    ]);
  });

  test('同じスラッグの見出しに-1・-2の連番を付ける', () => {
    const tree = root(
      heading('h2', 'A'),
      heading('h3', 'a'),
      heading('h2', 'A'),
    );

    expect(idsOf(assignHeadingIds(tree))).toEqual(['a', 'a-1', 'a-2']);
  });

  test('連番の付いたIDと同じ見出しが先にある場合は次の連番を付ける', () => {
    const tree = root(
      heading('h2', 'a'),
      heading('h2', 'a-1'),
      heading('h2', 'a'),
      heading('h2', 'a'),
    );

    expect(idsOf(assignHeadingIds(tree))).toEqual(['a', 'a-1', 'a-2', 'a-3']);
  });

  test('後ろにある脚注のIDと重なる見出しに連番を付け、脚注のIDを変えない', () => {
    const tree = root(
      heading('h2', 'fn-1'),
      heading('h2', 'footnote label'),
      element(
        'section',
        { dataFootnotes: true },
        element('h2', { id: 'footnote-label' }, text('脚注')),
        element('ol', {}, element('li', { id: 'fn-1' }, text('注釈'))),
      ),
    );

    const result = assignHeadingIds(tree);

    expect(idsOf(result)).toEqual(['fn-1-1', 'footnote-label-1', undefined]);
    expect(JSON.stringify(result.children[2])).toContain(
      '"id":"footnote-label"',
    );
    expect(JSON.stringify(result.children[2])).toContain('"id":"fn-1"');
  });

  test('既にIDを持つ要素のIDを見出しと同じ変換で正規化する', () => {
    const tree = root(
      element('li', { id: 'fn-a!b' }),
      element('a', { id: 'fnref-%E6%B3%A8' }),
    );

    expect(idsOf(assignHeadingIds(tree))).toEqual([
      'fn-a%21b',
      'fnref-%E6%B3%A8',
    ]);
  });

  test('入れ子の要素の中の見出しにもIDを付ける', () => {
    const tree = root(element('blockquote', {}, heading('h2', 'B')));

    expect(assignHeadingIds(tree)).toEqual(
      root(element('blockquote', {}, element('h2', { id: 'b' }, text('B')))),
    );
  });

  test('入力の木を書き換えない', () => {
    const tree = root(heading('h2', 'A'), element('li', { id: 'fn-a!b' }));
    const snapshot = structuredClone(tree);

    assignHeadingIds(tree);

    expect(tree).toEqual(snapshot);
  });

  test(`同じ文字列の見出しが${LONG_RUN_LENGTH.toLocaleString('en-US')}個あっても連番を線形の時間で付ける`, () => {
    const tree = root(
      ...Array.from({ length: LONG_RUN_LENGTH }, () => heading('h2', 'a')),
    );

    const startedAt = performance.now();
    const result = assignHeadingIds(tree);
    const elapsed = performance.now() - startedAt;

    expect(idsOf(result).at(-1)).toBe(`a-${String(LONG_RUN_LENGTH - 1)}`);
    expect(elapsed).toBeLessThan(MAX_ELAPSED_MILLISECONDS);
  });
});
