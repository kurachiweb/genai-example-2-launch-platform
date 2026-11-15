import { describe, expect, test } from 'bun:test';

import { SQLiteDialect } from 'drizzle-orm/sqlite-core';

import { displayableComment, validRating } from './engagement-conditions.ts';

const dialect = new SQLiteDialect();

describe('displayableComment', () => {
  test('削除・非公開化・匿名化の印が無く、投稿者が紐付いていて可視のコメントに絞り込む条件になる', () => {
    const query = dialect.sqlToQuery(displayableComment());

    expect(query.sql).toBe(
      '(("launch_comments"."deleted_at" is null) and ("launch_comments"."hidden_at" is null) and ("launch_comments"."anonymized_at" is null) and ("launch_comments"."author_user_id" is not null) and (("users"."deleted_at" is null) and "users"."status" = ?))',
    );
    expect(query.params).toEqual(['active']);
  });
});

describe('validRating', () => {
  test('無効化・論理削除の印が無く、評価者が可視の評価に絞り込む条件になる', () => {
    const query = dialect.sqlToQuery(validRating());

    expect(query.sql).toBe(
      '(("product_ratings"."invalidated_at" is null) and ("product_ratings"."deleted_at" is null) and (("users"."deleted_at" is null) and "users"."status" = ?))',
    );
    expect(query.params).toEqual(['active']);
  });
});
