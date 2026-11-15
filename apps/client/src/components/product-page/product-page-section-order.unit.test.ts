import { describe, expect, test } from 'bun:test';

import {
  groupProductPageSections,
  orderProductLaunchSections,
  orderProductOwnerActions,
  PRODUCT_PAGE_PLACEMENTS,
} from './product-page-section-order.ts';
import type {
  ProductLaunchSection,
  ProductOwnerAction,
  ProductPagePlacement,
  ProductPageSection,
} from './product-page-section-types.ts';

const nothing = (): null => null;

const sectionOf = (
  id: string,
  placement: ProductPagePlacement,
  order: number,
): ProductPageSection => ({ id, placement, order, component: nothing });

const launchSectionOf = (id: string, order: number): ProductLaunchSection => ({
  id,
  order,
  component: nothing,
});

const ownerActionOf = (id: string, order: number): ProductOwnerAction => ({
  id,
  order,
  component: nothing,
});

describe('PRODUCT_PAGE_PLACEMENTS', () => {
  test('置き場所はページ上部・本文・サイドバー・ページ末尾の4つである', () => {
    expect([...PRODUCT_PAGE_PLACEMENTS]).toStrictEqual([
      'banner',
      'main',
      'aside',
      'bottom',
    ]);
  });
});

describe('groupProductPageSections', () => {
  test('区画を置き場所ごとに分け、置き場所の中はorderの小さい順に並べる', () => {
    const sections = Object.freeze([
      sectionOf('directory-discovery.match-history', 'main', 40),
      sectionOf('sponsorship.silver', 'bottom', 20),
      sectionOf('engagement.rating', 'aside', 20),
      sectionOf('directory-discovery.screenshots', 'main', 20),
      sectionOf('sponsorship.legend', 'banner', 10),
      sectionOf('directory-discovery.owner', 'aside', 10),
      sectionOf('tournament.trophies', 'main', 10),
      sectionOf('content-reporting.report', 'bottom', 10),
      sectionOf('directory-discovery.description', 'main', 30),
    ]);

    const groups = groupProductPageSections(sections);
    const idsOf = (placement: ProductPagePlacement) =>
      groups[placement].map(({ id }) => id);

    expect(idsOf('banner')).toStrictEqual(['sponsorship.legend']);
    expect(idsOf('main')).toStrictEqual([
      'tournament.trophies',
      'directory-discovery.screenshots',
      'directory-discovery.description',
      'directory-discovery.match-history',
    ]);
    expect(idsOf('aside')).toStrictEqual([
      'directory-discovery.owner',
      'engagement.rating',
    ]);
    expect(idsOf('bottom')).toStrictEqual([
      'content-reporting.report',
      'sponsorship.silver',
    ]);
    expect(sections[0]?.id).toBe('directory-discovery.match-history');
  });

  test('登録の無い置き場所は空の一覧にする', () => {
    const groups = groupProductPageSections([]);

    expect(Object.keys(groups)).toStrictEqual([...PRODUCT_PAGE_PLACEMENTS]);
    expect(
      PRODUCT_PAGE_PLACEMENTS.every(
        (placement) => groups[placement].length === 0,
      ),
    ).toBe(true);
  });
});

describe('orderProductLaunchSections', () => {
  test('ローンチの区画をorderの小さい順に並べ、同じorderは登録の順を保つ', () => {
    expect(
      orderProductLaunchSections([
        launchSectionOf('b.late', 20),
        launchSectionOf('a.tie-first', 10),
        launchSectionOf('c.tie-second', 10),
      ]).map(({ id }) => id),
    ).toStrictEqual(['a.tie-first', 'c.tie-second', 'b.late']);
  });
});

describe('orderProductOwnerActions', () => {
  test('投稿者本人向けの操作をorderの小さい順に並べる', () => {
    expect(
      orderProductOwnerActions([
        ownerActionOf('tournament.year-fee', 20),
        ownerActionOf('tournament.week-fee', 10),
      ]).map(({ id }) => id),
    ).toStrictEqual(['tournament.week-fee', 'tournament.year-fee']);
  });
});
