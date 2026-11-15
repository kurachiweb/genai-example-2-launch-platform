import { describe, expect, test } from 'bun:test';

import { orderSections, sectionsByPlacement } from './section-order.ts';

type Placement = 'top' | 'side' | 'end';

interface Entry {
  readonly id: string;
  readonly placement: Placement;
  readonly order: number;
}

const entryOf = (id: string, placement: Placement, order: number): Entry => ({
  id,
  placement,
  order,
});

describe('orderSections', () => {
  test('orderの小さい順に並べ、同じorderは登録の順を保ち、元の一覧を変えない', () => {
    const entries = Object.freeze([
      entryOf('c.late', 'top', 30),
      entryOf('a.first', 'top', 10),
      entryOf('b.tie-first', 'top', 20),
      entryOf('d.tie-second', 'top', 20),
    ]);

    expect(orderSections(entries).map(({ id }) => id)).toStrictEqual([
      'a.first',
      'b.tie-first',
      'd.tie-second',
      'c.late',
    ]);
    expect(entries[0]?.id).toBe('c.late');
  });
});

describe('sectionsByPlacement', () => {
  test('置き場所ごとに、その置き場所の区画だけをorderの小さい順に返す', () => {
    const of = sectionsByPlacement([
      entryOf('x.end', 'end', 10),
      entryOf('x.side-late', 'side', 30),
      entryOf('x.top', 'top', 10),
      entryOf('x.side-early', 'side', 10),
    ]);

    expect(of('top').map(({ id }) => id)).toStrictEqual(['x.top']);
    expect(of('side').map(({ id }) => id)).toStrictEqual([
      'x.side-early',
      'x.side-late',
    ]);
    expect(of('end').map(({ id }) => id)).toStrictEqual(['x.end']);
  });

  test('登録の無い置き場所は空の一覧を返す', () => {
    const of = sectionsByPlacement([entryOf('x.side', 'side', 10)]);

    expect(of('top')).toStrictEqual([]);
    expect(of('end')).toStrictEqual([]);
  });
});
