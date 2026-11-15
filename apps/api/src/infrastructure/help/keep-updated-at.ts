import { type SQL, sql } from 'drizzle-orm';

// 更新日時の列は更新の文で自動的に現在時刻になるため、並び順と所属だけを変える文では元の値を明示して保つ
export const keepUpdatedAt: SQL = sql`${sql.identifier('updated_at')}`;
