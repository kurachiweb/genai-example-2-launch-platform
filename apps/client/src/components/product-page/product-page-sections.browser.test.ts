import { describe, expect, test, vi } from 'vitest';

import {
  PRODUCT_LAUNCH_SECTIONS,
  PRODUCT_OWNER_ACTIONS,
  PRODUCT_PAGE_SECTIONS,
} from '../../composition/product-page-sections.ts';
import { LaunchCommentsSection } from '../engagement/launch-comments-section.tsx';
import { ProductReportLink } from '../reporting/product-report-link.tsx';
import { RatingSection } from '../engagement/rating-section.tsx';
import { GoldSidebarPlacement } from '../sponsorship/gold-sidebar-placement.tsx';
import { LegendPlacement } from '../sponsorship/legend-placement.tsx';
import { SilverPlacement } from '../sponsorship/silver-placement.tsx';
import { TrophyShelf } from '../trophy/trophy-shelf.tsx';
import { WeekEntryOwnerAction } from '../week-tournament/week-entry-owner-action.tsx';
import { YearEntryOwnerAction } from '../year-tournament/year-entry-owner-action.tsx';
import { ProductDescriptionSection } from './product-description-section.tsx';
import { PRODUCT_PAGE_PLACEMENTS } from './product-page-section-order.ts';
import type { ProductPagePlacement } from './product-page-section-types.ts';
import { ScreenshotGallerySection } from './screenshot-gallery-section.tsx';

// 実行の関数はサーバー専用の処理を読み込むため、登録箇所の部品を読み込むテストでは差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

const PLACEMENTS: readonly ProductPagePlacement[] = PRODUCT_PAGE_PLACEMENTS;

describe('プロダクト詳細ページの登録箇所', () => {
  test('詳細ページの区画には本specのスクリーンショット(本文の20)・説明文(本文の30)・マッチ履歴(本文の40)・投稿者本人向けの操作(サイドバーの10)と、engagementの評価欄(サイドバーの20)、tournament-weekのトロフィー(本文の10)、sponsorshipのLegend(ページ上部の10)・Gold(サイドバーの30)・Silver(ページ末尾の20)、content-reportingの通報(ページ末尾の10)を登録する', () => {
    expect(
      PRODUCT_PAGE_SECTIONS.map(({ id, placement, order }) => ({
        id,
        placement,
        order,
      })),
    ).toStrictEqual([
      { id: 'directory-discovery.screenshots', placement: 'main', order: 20 },
      { id: 'directory-discovery.description', placement: 'main', order: 30 },
      {
        id: 'directory-discovery.match-history',
        placement: 'main',
        order: 40,
      },
      { id: 'directory-discovery.owner', placement: 'aside', order: 10 },
      { id: 'engagement.rating', placement: 'aside', order: 20 },
      { id: 'tournament-week.trophies', placement: 'main', order: 10 },
      { id: 'sponsorship.legend', placement: 'banner', order: 10 },
      { id: 'sponsorship.gold', placement: 'aside', order: 30 },
      { id: 'sponsorship.silver', placement: 'bottom', order: 20 },
      {
        id: 'content-reporting.product-report',
        placement: 'bottom',
        order: 10,
      },
    ]);
    expect(PRODUCT_PAGE_SECTIONS[0]?.component).toBe(ScreenshotGallerySection);
    expect(PRODUCT_PAGE_SECTIONS[1]?.component).toBe(ProductDescriptionSection);
    expect(PRODUCT_PAGE_SECTIONS[4]?.component).toBe(RatingSection);
    expect(PRODUCT_PAGE_SECTIONS[5]?.component).toBe(TrophyShelf);
    expect(PRODUCT_PAGE_SECTIONS[6]?.component).toBe(LegendPlacement);
    expect(PRODUCT_PAGE_SECTIONS[7]?.component).toBe(GoldSidebarPlacement);
    expect(PRODUCT_PAGE_SECTIONS[8]?.component).toBe(SilverPlacement);
    expect(PRODUCT_PAGE_SECTIONS[9]?.component).toBe(ProductReportLink);
  });

  test('ローンチの区画にはengagementのコメント欄(10)を登録する', () => {
    expect(
      PRODUCT_LAUNCH_SECTIONS.map(({ id, order }) => ({ id, order })),
    ).toStrictEqual([{ id: 'engagement.comments', order: 10 }]);
    expect(PRODUCT_LAUNCH_SECTIONS[0]?.component).toBe(LaunchCommentsSection);
  });

  test('投稿者本人向けの操作にはtournament-weekの参加費の導線(10)とtournament-yearの参加費の導線(20)を登録する', () => {
    expect(
      PRODUCT_OWNER_ACTIONS.map(({ id, order }) => ({ id, order })),
    ).toStrictEqual([
      { id: 'tournament-week.entry', order: 10 },
      { id: 'tournament-year.entry', order: 20 },
    ]);
    expect(PRODUCT_OWNER_ACTIONS[0]?.component).toBe(WeekEntryOwnerAction);
    expect(PRODUCT_OWNER_ACTIONS[1]?.component).toBe(YearEntryOwnerAction);
  });

  test.each([
    ['詳細ページの区画', PRODUCT_PAGE_SECTIONS],
    ['ローンチの区画', PRODUCT_LAUNCH_SECTIONS],
    ['投稿者本人向けの操作', PRODUCT_OWNER_ACTIONS],
  ] as const)(
    '%sのidは重複せず`<spec名>.<名詞句>`の形で、orderは有限の数である',
    (_name, entries) => {
      const ids = entries.map(({ id }) => id);

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => SECTION_ID_PATTERN.test(id))).toBe(true);
      expect(entries.every(({ order }) => Number.isFinite(order))).toBe(true);
    },
  );

  test('詳細ページの区画の置き場所は4つのいずれかである', () => {
    expect(
      PRODUCT_PAGE_SECTIONS.every(({ placement }) =>
        PLACEMENTS.includes(placement),
      ),
    ).toBe(true);
  });
});
