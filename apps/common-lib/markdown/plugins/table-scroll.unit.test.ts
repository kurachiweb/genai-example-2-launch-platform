import { describe, expect, test } from 'bun:test';

import type {
  HastElement,
  HastElementContent,
  HastProperties,
  HastRoot,
} from '../hast-types.ts';
import { wrapTables } from './table-scroll.ts';

const root = (...children: readonly HastElementContent[]): HastRoot => ({
  type: 'root',
  children,
});

const element = (
  tagName: string,
  properties: HastProperties,
  ...children: readonly HastElementContent[]
): HastElement => ({ type: 'element', tagName, properties, children });

const table = (cell: string): HastElement =>
  element(
    'table',
    {},
    element(
      'tbody',
      {},
      element('tr', {}, element('td', {}, { type: 'text', value: cell })),
    ),
  );

const scrollRegion = (child: HastElement): HastElement =>
  element(
    'div',
    {
      className: ['markdown-table-scroll'],
      tabIndex: 0,
      role: 'region',
      ariaLabel: '表(横にスクロールできます)',
    },
    child,
  );

describe('wrapTables', () => {
  test('表をキーボードで移動できる名前付きの横スクロールの領域で包む', () => {
    expect(wrapTables(root(table('a')))).toEqual(
      root(scrollRegion(table('a'))),
    );
  });

  test('複数の表をそれぞれ包む', () => {
    expect(wrapTables(root(table('a'), table('b')))).toEqual(
      root(scrollRegion(table('a')), scrollRegion(table('b'))),
    );
  });

  test('引用やリストの中の表も包む', () => {
    const tree = root(
      element('blockquote', {}, table('a')),
      element('ul', {}, element('li', {}, table('b'))),
    );

    expect(wrapTables(tree)).toEqual(
      root(
        element('blockquote', {}, scrollRegion(table('a'))),
        element('ul', {}, element('li', {}, scrollRegion(table('b')))),
      ),
    );
  });

  test('表の無い木を変更しない', () => {
    const tree = root(element('p', {}, { type: 'text', value: '本文' }));
    const snapshot = structuredClone(tree);

    expect(wrapTables(tree)).toEqual(snapshot);
    expect(tree).toEqual(snapshot);
  });
});
