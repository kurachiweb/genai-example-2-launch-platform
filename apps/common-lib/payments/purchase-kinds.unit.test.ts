import { describe, expect, test } from 'bun:test';

import {
  PURCHASE_KIND_LABELS,
  PURCHASE_KIND_MODES,
  PURCHASE_KINDS,
} from './purchase-kinds.ts';

describe('PURCHASE_KINDS', () => {
  test('トーナメント参加費2種・スポンサー広告・Ultras・疎通確認の5種を持つ', () => {
    expect([...PURCHASE_KINDS]).toEqual([
      'week_tournament_entry',
      'year_tournament_entry',
      'sponsorship',
      'ultras',
      'payments_smoke',
    ]);
  });

  test('一覧は変更できない', () => {
    expect(Object.isFrozen(PURCHASE_KINDS)).toBe(true);
  });
});

describe('PURCHASE_KIND_MODES', () => {
  test('Ultrasだけが定期課金で、他は都度決済になる', () => {
    expect(PURCHASE_KIND_MODES).toEqual({
      week_tournament_entry: 'payment',
      year_tournament_entry: 'payment',
      sponsorship: 'payment',
      ultras: 'subscription',
      payments_smoke: 'payment',
    });
  });

  test('区分の対応は変更できない', () => {
    expect(Object.isFrozen(PURCHASE_KIND_MODES)).toBe(true);
  });
});

describe('PURCHASE_KIND_LABELS', () => {
  test('各購入種別の名前が料金とプランの課金項目の呼び方になる', () => {
    expect(PURCHASE_KIND_LABELS).toEqual({
      week_tournament_entry: 'Weekトーナメント参加費',
      year_tournament_entry: 'Yearトーナメント参加費',
      sponsorship: 'スポンサー広告',
      ultras: 'Ultrasプラン',
      payments_smoke: '決済の疎通確認',
    });
  });

  test('名前の対応は変更できない', () => {
    expect(Object.isFrozen(PURCHASE_KIND_LABELS)).toBe(true);
  });
});
