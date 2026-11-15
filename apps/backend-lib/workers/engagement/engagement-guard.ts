import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

// コメントと評価の条件付きの書き込みは、条件が成り立たないとproduct_idにNULLを入れてNOT NULLの違反で一括の書き込み全体を取り消す
// D1は`D1_ERROR: NOT NULL constraint failed: <テーブル>.product_id: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ
const GUARD_VIOLATION_PATTERN =
  /NOT NULL constraint failed: (?:launch_comments|product_ratings)\.product_id(?::|$)/u;

export function guardedProductId(
  condition: SQL,
  productId: SQLWrapper | string,
): SQL {
  return sql`CASE WHEN ${condition} THEN ${productId} ELSE NULL END`;
}

export function isEngagementGuardViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (GUARD_VIOLATION_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}
