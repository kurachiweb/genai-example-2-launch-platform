import { describe, expect, test } from 'bun:test';

import type {
  ProductHandleResolution,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import { decideProductPageAccess } from './product-page-access.ts';

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

const current = (
  overrides: Partial<ProductSummaryRecord> = {},
): ProductHandleResolution => ({
  kind: 'current',
  product: product(overrides),
});

const previous = (
  overrides: Partial<ProductSummaryRecord> = {},
): ProductHandleResolution => ({
  kind: 'previous',
  product: product(overrides),
});

describe('decideProductPageAccess の404', () => {
  test('ハンドルが解決されなければ404にする', () => {
    expect(
      decideProductPageAccess({
        resolution: { kind: 'none' },
        viewerUserId: OWNER_ID,
      }),
    ).toEqual({ kind: 'not-found' });
  });

  test.each([
    ['非公開化', { hidden: true, visible: false }],
    ['投稿者の停止・退会', { hidden: false, visible: false }],
  ] as const)(
    '%sで可視でないプロダクトは投稿者本人にも404にする',
    (_, overrides) => {
      for (const viewerUserId of [OWNER_ID, OTHER_ID, undefined]) {
        expect(
          decideProductPageAccess({
            resolution: current(overrides),
            viewerUserId,
          }),
        ).toEqual({ kind: 'not-found' });
      }
    },
  );

  test.each([OTHER_ID, undefined])(
    '未掲載のプロダクトは投稿者本人でない閲覧者(%s)に404にする',
    (viewerUserId) => {
      expect(
        decideProductPageAccess({
          resolution: current({ listed: false }),
          viewerUserId,
        }),
      ).toEqual({ kind: 'not-found' });
    },
  );
});

describe('decideProductPageAccess の表示', () => {
  test('掲載中のプロダクトは誰にでも表示する', () => {
    expect(
      decideProductPageAccess({
        resolution: current(),
        viewerUserId: undefined,
      }),
    ).toEqual({
      kind: 'render',
      productId: 'product-1',
      ownerView: false,
      unlisted: false,
    });
    expect(
      decideProductPageAccess({
        resolution: current(),
        viewerUserId: OTHER_ID,
      }),
    ).toEqual({
      kind: 'render',
      productId: 'product-1',
      ownerView: false,
      unlisted: false,
    });
  });

  test('掲載中のプロダクトを投稿者本人が開くと本人の表示にする', () => {
    expect(
      decideProductPageAccess({
        resolution: current(),
        viewerUserId: OWNER_ID,
      }),
    ).toEqual({
      kind: 'render',
      productId: 'product-1',
      ownerView: true,
      unlisted: false,
    });
  });

  test('未掲載のプロダクトは投稿者本人にだけ未掲載の印を付けて表示する', () => {
    expect(
      decideProductPageAccess({
        resolution: current({ listed: false }),
        viewerUserId: OWNER_ID,
      }),
    ).toEqual({
      kind: 'render',
      productId: 'product-1',
      ownerView: true,
      unlisted: true,
    });
  });
});

describe('decideProductPageAccess の旧ハンドル', () => {
  test('表示できるプロダクトの旧ハンドルは現在のハンドルへ転送する', () => {
    expect(
      decideProductPageAccess({
        resolution: previous(),
        viewerUserId: undefined,
      }),
    ).toEqual({ kind: 'redirect', handle: 'current-handle' });
  });

  test('未掲載のプロダクトの旧ハンドルは投稿者本人にだけ転送する', () => {
    expect(
      decideProductPageAccess({
        resolution: previous({ listed: false }),
        viewerUserId: OWNER_ID,
      }),
    ).toEqual({ kind: 'redirect', handle: 'current-handle' });
    expect(
      decideProductPageAccess({
        resolution: previous({ listed: false }),
        viewerUserId: OTHER_ID,
      }),
    ).toEqual({ kind: 'not-found' });
  });

  test('可視でないプロダクトの旧ハンドルは転送せず現在のハンドルを返さない', () => {
    const access = decideProductPageAccess({
      resolution: previous({ hidden: true, visible: false }),
      viewerUserId: OWNER_ID,
    });

    expect(access).toEqual({ kind: 'not-found' });
    expect(JSON.stringify(access)).not.toContain('current-handle');
  });
});
