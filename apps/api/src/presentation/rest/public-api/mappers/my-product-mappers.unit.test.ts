import { describe, expect, test } from 'bun:test';

import { toMyProductView } from '../../../../application/product/my-product-view.ts';
import type { MyProductView } from '../../../../application/product/ports.ts';
import {
  PRODUCT_ID,
  snapshotOf,
} from '../../../../application/product/testing/product-editor-fixtures.ts';
import {
  currentUserOf,
  stateOf,
} from '../../../../application/product/testing/product-fakes.ts';
import { toMyProduct, toMyProductListPage } from './my-product-mappers.ts';

const SITE_ORIGIN = 'https://launch.example';

const OWNER = currentUserOf().user;

const viewOf = (overrides: Partial<MyProductView> = {}): MyProductView => ({
  ...toMyProductView(snapshotOf(), stateOf(PRODUCT_ID), OWNER),
  ...overrides,
});

describe('toMyProduct', () => {
  test('idをproductIdから写し、ハンドル・名称・説明文・掲載と非公開化の状態・ページのURLだけを返す', () => {
    const view = viewOf({
      productId: '01JD0PR0DVCT00000000000009',
      handle: 'launch-meter',
      previousHandle: 'launch-meter-old',
      name: 'ローンチ計測',
      descriptionMarkdown: '# 概要\n\n本文',
      listed: true,
      hidden: false,
    });

    expect(toMyProduct(view, SITE_ORIGIN)).toEqual({
      id: '01JD0PR0DVCT00000000000009',
      handle: 'launch-meter',
      name: 'ローンチ計測',
      description_markdown: '# 概要\n\n本文',
      listed: true,
      hidden: false,
      page_url: 'https://launch.example/p/launch-meter',
    });
  });

  test('未掲載・非公開化中のプロダクトもその状態のまま返す', () => {
    const product = toMyProduct(
      viewOf({ listed: false, hidden: true }),
      SITE_ORIGIN,
    );

    expect(product.listed).toBe(false);
    expect(product.hidden).toBe(true);
  });
});

describe('toMyProductListPage', () => {
  test('上流の並びのまま項目を写し、続きの有無と上流のカーソルをそのまま返す', () => {
    const first = viewOf({
      productId: '01JD0PR0DVCT00000000000002',
      handle: 'b',
    });
    const second = viewOf({
      productId: '01JD0PR0DVCT00000000000001',
      handle: 'a',
    });

    expect(
      toMyProductListPage(
        { nodes: [first, second], hasNextPage: true, endCursor: 'cursor-2' },
        SITE_ORIGIN,
      ),
    ).toEqual({
      data: [toMyProduct(first, SITE_ORIGIN), toMyProduct(second, SITE_ORIGIN)],
      meta: { has_next: true, next_cursor: 'cursor-2' },
    });
  });

  test('空のページは空の一覧と続きの無いことを返す', () => {
    expect(
      toMyProductListPage(
        { nodes: [], hasNextPage: false, endCursor: null },
        SITE_ORIGIN,
      ),
    ).toEqual({ data: [], meta: { has_next: false, next_cursor: null } });
  });
});
