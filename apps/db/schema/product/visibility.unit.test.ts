import { describe, expect, test } from 'bun:test';

import { SQLiteDialect } from 'drizzle-orm/sqlite-core';

import {
  productInCategory,
  visibleProducts,
  wonLaunchExists,
} from './visibility.ts';

const dialect = new SQLiteDialect();

describe('visibleProducts', () => {
  test('論理削除・非公開化していないプロダクトのうち、投稿者が可視のものに絞り込む条件になる', () => {
    const query = dialect.sqlToQuery(visibleProducts());

    expect(query.sql).toBe(
      '(("products"."deleted_at" is null) and ("products"."hidden_at" is null) and (("users"."deleted_at" is null) and "users"."status" = ?))',
    );
    expect(query.params).toEqual(['active']);
  });
});

describe('wonLaunchExists', () => {
  test('取消でない勝利のローンチを持つプロダクトに絞り込む相関の条件になる', () => {
    const query = dialect.sqlToQuery(wonLaunchExists());

    expect(query.sql).toBe(
      'exists (select 1 from "product_launches" where "product_launches"."product_id" = "products"."id" and "product_launches"."outcome" = ? and ("product_launches"."cancelled_at" is null))',
    );
    expect(query.params).toEqual(['won']);
  });
});

describe('productInCategory', () => {
  test('カテゴリのIDをバインド変数で渡して、そのカテゴリのプロダクトに絞り込む条件になる', () => {
    const query = dialect.sqlToQuery(
      productInCategory('01JD0000000000000000000000'),
    );

    expect(query.sql).toBe('"products"."category_id" = ?');
    expect(query.params).toEqual(['01JD0000000000000000000000']);
  });
});
