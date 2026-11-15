import { describe, expect, test } from 'bun:test';

import type { LaunchStatus } from '../../../lib/core/product/launch-status.ts';
import type {
  LaunchRecord,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import { canViewProduct, isCommentableLaunch } from './engagement-access.ts';

const OWNER_ID = 'owner-1';
const OTHER_ID = 'viewer-1';

const product = (
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord => ({
  productId: 'product-1',
  ownerUserId: OWNER_ID,
  handle: 'current-handle',
  name: 'プロダクト',
  tagline: 'タグライン',
  category: { id: 'category-1', name: 'その他', handle: 'other' },
  websiteUrl: 'https://product.example',
  logoFileId: 'file-1',
  hidden: false,
  visible: true,
  listed: true,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  ...overrides,
});

const launch = (status: LaunchStatus): LaunchRecord => ({
  launchId: 'launch-1',
  productId: 'product-1',
  number: status === 'canceled' ? 0 : 1,
  launchDate: parseBusinessDate('2026-10-01'),
  status,
  outcome: null,
  decidedAt: null,
});

describe('canViewProduct の閲覧できない場合', () => {
  test.each([OWNER_ID, OTHER_ID, undefined])(
    '照会の結果に無いプロダクトは閲覧者(%s)に閲覧させない',
    (viewerUserId) => {
      expect(canViewProduct(undefined, viewerUserId)).toBe(false);
    },
  );

  test.each([
    ['非公開化', { hidden: true, visible: false }],
    ['投稿者の停止・退会', { hidden: false, visible: false }],
  ] as const)(
    '%sで可視でないプロダクトは投稿者本人にも閲覧させない',
    (_, overrides) => {
      for (const viewerUserId of [OWNER_ID, OTHER_ID, undefined]) {
        expect(canViewProduct(product(overrides), viewerUserId)).toBe(false);
      }
    },
  );

  test.each([OTHER_ID, undefined])(
    '未掲載のプロダクトは投稿者本人でない閲覧者(%s)に閲覧させない',
    (viewerUserId) => {
      expect(canViewProduct(product({ listed: false }), viewerUserId)).toBe(
        false,
      );
    },
  );
});

describe('canViewProduct の閲覧できる場合', () => {
  test.each([OWNER_ID, OTHER_ID, undefined])(
    '掲載中のプロダクトは閲覧者(%s)に閲覧させる',
    (viewerUserId) => {
      expect(canViewProduct(product(), viewerUserId)).toBe(true);
    },
  );

  test('未掲載のプロダクトは投稿者本人にだけ閲覧させる', () => {
    expect(canViewProduct(product({ listed: false }), OWNER_ID)).toBe(true);
  });
});

describe('isCommentableLaunch', () => {
  test.each(['in_progress', 'finished'] as const)(
    'キックオフ済みのローンチ(%s)にはコメントできる',
    (status) => {
      expect(isCommentableLaunch(launch(status))).toBe(true);
    },
  );

  test.each(['scheduled', 'paired', 'canceled'] as const)(
    'キックオフ前か取消のローンチ(%s)にはコメントできない',
    (status) => {
      expect(isCommentableLaunch(launch(status))).toBe(false);
    },
  );

  test('存在しないローンチにはコメントできない', () => {
    expect(isCommentableLaunch(undefined)).toBe(false);
  });
});
