import { describe, expect, test } from 'bun:test';

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
