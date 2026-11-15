import { isNotNull, sql } from 'drizzle-orm';

import { productCategories } from '../../../db/schema/product/product-categories.ts';
import { products } from '../../../db/schema/product/products.ts';
import {
  visibleProducts,
  wonLaunchExists,
} from '../../../db/schema/product/visibility.ts';
import type { ProductSummaryRecord } from '../../core/product/ports.ts';

function isTrue(value: unknown): boolean {
  return Number(value) === 1;
}

// productsとusers・product_categoriesを結合した問い合わせで使う
export function productSummaryColumns() {
  return {
    productId: products.id,
    ownerUserId: products.userId,
    handle: products.handle,
    name: products.name,
    tagline: products.tagline,
    categoryId: productCategories.id,
    categoryName: productCategories.name,
    categoryHandle: productCategories.handle,
    websiteUrl: products.websiteUrl,
    logoFileId: products.logoFileId,
    hidden: sql<boolean>`${isNotNull(products.hiddenAt)}`.mapWith(isTrue),
    visible: sql<boolean>`${visibleProducts()}`.mapWith(isTrue),
    listed:
      sql<boolean>`(${visibleProducts()} and ${wonLaunchExists()})`.mapWith(
        isTrue,
      ),
    createdAt: products.createdAt,
  };
}

export interface ProductSummaryRow {
  readonly productId: string;
  readonly ownerUserId: string;
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly categoryHandle: string;
  readonly websiteUrl: string;
  readonly logoFileId: string;
  readonly hidden: boolean;
  readonly visible: boolean;
  readonly listed: boolean;
  readonly createdAt: Date;
}

export function toProductSummaryRecord(
  row: ProductSummaryRow,
): ProductSummaryRecord {
  return {
    productId: row.productId,
    ownerUserId: row.ownerUserId,
    handle: row.handle,
    name: row.name,
    tagline: row.tagline,
    category: {
      id: row.categoryId,
      name: row.categoryName,
      handle: row.categoryHandle,
    },
    websiteUrl: row.websiteUrl,
    logoFileId: row.logoFileId,
    hidden: row.hidden,
    visible: row.visible,
    listed: row.listed,
    createdAt: row.createdAt,
  };
}
