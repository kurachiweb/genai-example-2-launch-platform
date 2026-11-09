import { describe, expect, test, vi } from 'vitest';

import {
  PUBLIC_PROFILE_BADGES,
  PUBLIC_PROFILE_MENU_ITEMS,
  PUBLIC_PROFILE_TABS,
} from '../../composition/public-profile-sections.ts';
import { LaunchHistoryCount } from '../launch-history/launch-history-count.tsx';
import { LaunchHistoryPanel } from '../launch-history/launch-history-panel.tsx';
import { ProfileAwardBadges } from '../launch-history/profile-award-badges.tsx';
import { resolveProfileTab } from './public-profile-section-order.ts';

// 実行の関数はサーバー専用の処理を読み込むため、登録箇所の部品を読み込むテストでは差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

describe('公開プロフィールの区画の登録箇所', () => {
  test('タブにはproduct-launchのローンチ履歴を、受賞バッジにはproduct-launchの受賞バッジを登録し、「…」メニューの項目の登録箇所は空である', () => {
    expect(PUBLIC_PROFILE_TABS).toStrictEqual([
      {
        id: 'launches',
        label: 'ローンチ履歴',
        order: 10,
        Count: LaunchHistoryCount,
        Panel: LaunchHistoryPanel,
      },
    ]);
    expect(PUBLIC_PROFILE_BADGES).toStrictEqual([
      {
        id: 'product-launch.award-badges',
        order: 10,
        Section: ProfileAwardBadges,
      },
    ]);
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
