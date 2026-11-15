import { describe, expect, test } from 'bun:test';

import {
  checkCategoryEditable,
  sortCategories,
} from './inquiry-category-rules.ts';

interface Category {
  readonly id: string;
  readonly systemDefault: boolean;
  readonly createdAt: Date;
}

const category = (
  id: string,
  createdAt: string,
  systemDefault = false,
): Category => ({ id, systemDefault, createdAt: new Date(createdAt) });

describe('checkCategoryEditable', () => {
  test('標準カテゴリの名前の変更と削除はprotectedで拒否する', () => {
    expect(checkCategoryEditable({ systemDefault: true })).toBe('protected');
  });

  test('管理者が追加したカテゴリは名前の変更と削除ができる', () => {
    expect(checkCategoryEditable({ systemDefault: false })).toBeUndefined();
  });
});

describe('sortCategories', () => {
  test('追加したカテゴリを作成日時の古い順に並べる', () => {
    const later = category(
      '01JC0000000000000000000003',
      '2026-11-03T00:00:00Z',
    );
    const earliest = category(
      '01JC0000000000000000000001',
      '2026-11-01T00:00:00Z',
    );
    const middle = category(
      '01JC0000000000000000000002',
      '2026-11-02T00:00:00Z',
    );

    expect(sortCategories([later, earliest, middle])).toEqual([
      earliest,
      middle,
      later,
    ]);
  });

  test('標準カテゴリは作成日時が最も古くても末尾に置く', () => {
    const other = category(
      '01JC0000000000000000000000',
      '2024-11-06T05:43:40.288Z',
      true,
    );
    const first = category(
      '01JC0000000000000000000001',
      '2026-11-01T00:00:00Z',
    );
    const second = category(
      '01JC0000000000000000000002',
      '2026-11-02T00:00:00Z',
    );

    expect(sortCategories([other, second, first])).toEqual([
      first,
      second,
      other,
    ]);
  });

  test('作成日時が同じカテゴリはIDの昇順に並べる', () => {
    const createdAt = '2026-11-01T00:00:00Z';
    const larger = category('01JC0000000000000000000002', createdAt);
    const smaller = category('01JC0000000000000000000001', createdAt);

    expect(sortCategories([larger, smaller])).toEqual([smaller, larger]);
  });

  test('標準カテゴリだけなら1件のまま返す', () => {
    const other = category(
      '01JC0000000000000000000000',
      '2024-11-06T05:43:40.288Z',
      true,
    );

    expect(sortCategories([other])).toEqual([other]);
  });

  test('並べ替えの元の配列を変えない', () => {
    const second = category(
      '01JC0000000000000000000002',
      '2026-11-02T00:00:00Z',
    );
    const first = category(
      '01JC0000000000000000000001',
      '2026-11-01T00:00:00Z',
    );
    const categories = [second, first];

    sortCategories(categories);

    expect(categories).toEqual([second, first]);
  });

  test('並べ替えた要素は渡した要素の他の項目を保つ', () => {
    const named = {
      ...category('01JC0000000000000000000001', '2026-11-01T00:00:00Z'),
      name: '不具合の報告',
    };

    expect(sortCategories([named])[0]?.name).toBe('不具合の報告');
  });
});
