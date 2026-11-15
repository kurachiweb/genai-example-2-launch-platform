import { describe, expect, test } from 'bun:test';

import {
  orderPublicProfileSections,
  profileTabQueryValue,
  resolveProfileTab,
} from './public-profile-section-order.ts';
import type { PublicProfileTab } from './public-profile-section-types.ts';

const noop = () => null;

const tab = (id: string, order: number): PublicProfileTab => ({
  id,
  label: id,
  order,
  Panel: noop,
});

const TABS: readonly PublicProfileTab[] = Object.freeze([
  tab('upvotes', 20),
  tab('launches', 10),
  tab('reviews', 30),
]);

describe('公開プロフィールの区画の順序', () => {
  test('登録の順によらず、orderの小さい順に並べ、元の一覧を変えない', () => {
    const ordered = orderPublicProfileSections(TABS);

    expect(ordered.map(({ id }) => id)).toStrictEqual([
      'launches',
      'upvotes',
      'reviews',
    ]);
    expect(TABS[0]?.id).toBe('upvotes');
  });

  test('登録が無ければ空の一覧を返す', () => {
    expect(orderPublicProfileSections([])).toStrictEqual([]);
  });
});

describe('タブのクエリの値の解決', () => {
  test('登録されている値は、そのタブを選ぶ', () => {
    expect(resolveProfileTab(TABS, 'upvotes')?.id).toBe('upvotes');
  });

  test('省略された値は、orderが最小のタブを選ぶ', () => {
    expect(resolveProfileTab(TABS, undefined)?.id).toBe('launches');
  });

  test('登録されていない値は、orderが最小のタブを選ぶ', () => {
    expect(resolveProfileTab(TABS, 'unknown')?.id).toBe('launches');
    expect(resolveProfileTab(TABS, '')?.id).toBe('launches');
  });

  test('値の大文字小文字は区別して、別の値として扱う', () => {
    expect(resolveProfileTab(TABS, 'Upvotes')?.id).toBe('launches');
  });

  test('タブが1つも無ければ、選ぶタブは無い', () => {
    expect(resolveProfileTab([], 'launches')).toBeUndefined();
    expect(resolveProfileTab([], undefined)).toBeUndefined();
  });

  test('orderが最小のタブはURLのクエリを省略し、他のタブは値を返す', () => {
    expect(profileTabQueryValue(TABS, 'launches')).toBeUndefined();
    expect(profileTabQueryValue(TABS, 'upvotes')).toBe('upvotes');
    expect(profileTabQueryValue(TABS, 'reviews')).toBe('reviews');
  });

  test('未登録の値と、タブが無いときの値は、クエリを省略する', () => {
    expect(profileTabQueryValue(TABS, 'unknown')).toBeUndefined();
    expect(profileTabQueryValue([], 'launches')).toBeUndefined();
  });
});
