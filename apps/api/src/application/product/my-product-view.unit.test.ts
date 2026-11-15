import { describe, expect, test } from 'bun:test';

import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import { toMyProductView } from './my-product-view.ts';
import type { ProductSnapshot } from './ports.ts';
import {
  CATEGORY,
  currentUserOf,
  LOGO_FILE_ID,
  stateOf,
  USER_ID,
} from './testing/product-fakes.ts';

const PRODUCT_ID = '01JD0PRODUCT00000000000001';

const launchOf = (overrides: Partial<LaunchRecord> = {}): LaunchRecord => ({
  launchId: '01JD0LAUNCH000000000000001',
  productId: PRODUCT_ID,
  number: 1,
  launchDate: parseBusinessDate('2026-10-10'),
  status: 'finished',
  outcome: 'won',
  decidedAt: new Date('2026-10-10T15:00:00.000Z'),
  ...overrides,
});

const snapshotOf = (
  overrides: Partial<ProductSnapshot> = {},
): ProductSnapshot => ({
  productId: PRODUCT_ID,
  ownerUserId: USER_ID,
  handle: 'launch-meter',
  previousHandle: null,
  name: 'ローンチ計測',
  tagline: '公開の反応をまとめて見る',
  category: CATEGORY,
  websiteUrl: 'https://launch-meter.example/',
  descriptionMarkdown: '# 概要',
  logoFileId: LOGO_FILE_ID,
  screenshotFileIds: [],
  hidden: false,
  version: 2,
  launches: [launchOf()],
  ...overrides,
});

describe('toMyProductView', () => {
  test('投稿者とローンチの一覧を除き、判定した状態を添える', () => {
    const state = stateOf(PRODUCT_ID);

    const view = toMyProductView(snapshotOf(), state, currentUserOf().user);

    expect(view).toEqual({
      productId: PRODUCT_ID,
      handle: 'launch-meter',
      previousHandle: null,
      name: 'ローンチ計測',
      tagline: '公開の反応をまとめて見る',
      category: CATEGORY,
      websiteUrl: 'https://launch-meter.example/',
      descriptionMarkdown: '# 概要',
      logoFileId: LOGO_FILE_ID,
      screenshotFileIds: [],
      hidden: false,
      listed: true,
      version: 2,
      state,
    });
  });

  test('予選で勝利したローンチの無いプロダクトは掲載されない', () => {
    const view = toMyProductView(
      snapshotOf({
        launches: [
          launchOf({ outcome: 'lost' }),
          launchOf({ status: 'scheduled', outcome: null, decidedAt: null }),
        ],
      }),
      stateOf(PRODUCT_ID),
      currentUserOf().user,
    );

    expect(view.listed).toBe(false);
  });

  test('取消のローンチの勝利は掲載の根拠にしない', () => {
    const view = toMyProductView(
      snapshotOf({ launches: [launchOf({ status: 'canceled', number: 0 })] }),
      stateOf(PRODUCT_ID),
      currentUserOf().user,
    );

    expect(view.listed).toBe(false);
  });

  test('非公開化中のプロダクトは掲載されない', () => {
    const view = toMyProductView(
      snapshotOf({ hidden: true }),
      stateOf(PRODUCT_ID),
      currentUserOf().user,
    );

    expect(view.listed).toBe(false);
  });

  test.each([
    ['停止中', { status: 'suspended' as const }],
    ['退会済み', { deletedAt: new Date('2026-10-20T00:00:00.000Z') }],
  ])('%sの投稿者のプロダクトは掲載されない', (_, overrides) => {
    const view = toMyProductView(
      snapshotOf(),
      stateOf(PRODUCT_ID),
      currentUserOf(overrides).user,
    );

    expect(view.listed).toBe(false);
  });
});
