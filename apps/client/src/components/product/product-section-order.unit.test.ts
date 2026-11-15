import { describe, expect, test } from 'bun:test';

import { MY_PRODUCT_SECTIONS } from '../../composition/my-product-sections.ts';
import { PRODUCT_DELETE_NOTICES } from '../../composition/product-delete-notices.ts';
import { orderProductSections } from './product-section-order.ts';
import type {
  MyProductSection,
  ProductDeleteNotice,
} from './product-section-types.ts';

const noop = () => null;

const section = (id: string, order: number): MyProductSection => ({
  id,
  order,
  component: noop,
});

const notice = (id: string, order: number): ProductDeleteNotice => ({
  id,
  order,
  component: noop,
});

describe('自分のプロダクトの区画と削除の注意書きの順序', () => {
  test('区画は登録の順によらず、orderの小さい順に並べ、元の一覧を変えない', () => {
    const sections = Object.freeze([
      section('tournament-year.entry-fee', 20),
      section('tournament-week.entry-fee', 10),
      section('sponsorship.ad', 30),
    ]);

    const ordered = orderProductSections(sections);

    expect(ordered.map(({ id }) => id)).toStrictEqual([
      'tournament-week.entry-fee',
      'tournament-year.entry-fee',
      'sponsorship.ad',
    ]);
    expect(sections[0]?.id).toBe('tournament-year.entry-fee');
  });

  test('削除の注意書きも、orderの小さい順に並べる', () => {
    const notices = Object.freeze([
      notice('sponsorship.active-ad', 30),
      notice('tournament-week.entry', 10),
    ]);

    expect(orderProductSections(notices).map(({ id }) => id)).toStrictEqual([
      'tournament-week.entry',
      'sponsorship.active-ad',
    ]);
  });

  test('同じorderの登録は、登録の順を保つ', () => {
    const sections = [section('a.first', 10), section('b.second', 10)];

    expect(orderProductSections(sections).map(({ id }) => id)).toStrictEqual([
      'a.first',
      'b.second',
    ]);
  });

  test('登録が無ければ空の一覧を返す', () => {
    expect(orderProductSections([])).toStrictEqual([]);
  });
});

describe('登録箇所', () => {
  test('初版の2つの登録箇所は空である', () => {
    expect(MY_PRODUCT_SECTIONS).toStrictEqual([]);
    expect(PRODUCT_DELETE_NOTICES).toStrictEqual([]);
  });

  test.each([
    ['自分のプロダクトの区画', MY_PRODUCT_SECTIONS],
    ['削除の注意書き', PRODUCT_DELETE_NOTICES],
  ] as const)(
    '%sのidは重複せず`<spec名>.<名詞句>`の形で、orderは有限の数である',
    (_name, entries) => {
      const ids = entries.map(({ id }) => id);

      expect(new Set(ids).size).toBe(ids.length);
      expect(
        ids.every((id) => /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u.test(id)),
      ).toBe(true);
      expect(entries.every(({ order }) => Number.isFinite(order))).toBe(true);
    },
  );
});
