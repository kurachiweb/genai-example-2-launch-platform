import { describe, expect, test } from 'bun:test';

import {
  PUBLIC_PROFILE_BADGES,
  PUBLIC_PROFILE_MENU_ITEMS,
  PUBLIC_PROFILE_TABS,
} from '../../composition/public-profile-sections.ts';
import { LaunchHistoryCount } from '../launch-history/launch-history-count.tsx';
import { LaunchHistoryPanel } from '../launch-history/launch-history-panel.tsx';
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

describe('登録箇所', () => {
  test('タブにはproduct-launchのローンチ履歴を登録し、受賞バッジと「…」メニューの項目の登録箇所は空である', () => {
    expect(PUBLIC_PROFILE_TABS).toStrictEqual([
      {
        id: 'launches',
        label: 'ローンチ履歴',
        order: 10,
        Count: LaunchHistoryCount,
        Panel: LaunchHistoryPanel,
      },
    ]);
    expect(PUBLIC_PROFILE_BADGES).toStrictEqual([]);
    expect(PUBLIC_PROFILE_MENU_ITEMS).toStrictEqual([]);
  });

  test('ローンチ履歴はorderが最小のため既定のタブになる', () => {
    expect(resolveProfileTab(PUBLIC_PROFILE_TABS, undefined)?.id).toBe(
      'launches',
    );
  });

  test.each([
    ['タブ', PUBLIC_PROFILE_TABS],
    ['受賞バッジ', PUBLIC_PROFILE_BADGES],
    ['「…」メニューの項目', PUBLIC_PROFILE_MENU_ITEMS],
  ] as const)('%sのidは重複せず、orderは有限の数である', (_name, entries) => {
    const ids = entries.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(entries.every(({ order }) => Number.isFinite(order))).toBe(true);
  });

  test('タブのidはURLのクエリに使える形である', () => {
    expect(
      PUBLIC_PROFILE_TABS.every(({ id }) => /^[a-z][a-z0-9-]*$/u.test(id)),
    ).toBe(true);
  });
});
