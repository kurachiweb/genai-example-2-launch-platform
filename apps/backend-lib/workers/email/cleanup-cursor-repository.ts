import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../../../db/client.ts';
import { emailCleanupCursors } from '../../../db/schema/email/email-cleanup-cursors.ts';

// 後始末で最後に確かめた照合キー。undefinedは次の実行で先頭から確かめることを表す
export interface CleanupCursorStore {
  read(name: string): Promise<string | undefined>;
  save(name: string, afterKey: string | undefined, now: Date): Promise<void>;
  // 位置が指す照合キーを消すときに、そのアドレスを位置の行に残さず先頭へ戻す
  resetIfAt(name: string, key: string): Promise<void>;
}

export function createCleanupCursorRepository(
  db: Database,
): CleanupCursorStore {
  return {
    async read(name) {
      const [row] = await db
        .select({ afterKey: emailCleanupCursors.afterKey })
        .from(emailCleanupCursors)
        .where(eq(emailCleanupCursors.name, name));
      return row?.afterKey ?? undefined;
    },

    async save(name, afterKey, now) {
      await db
        .insert(emailCleanupCursors)
        .values({
          name,
          afterKey: afterKey ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: emailCleanupCursors.name,
          set: { afterKey: afterKey ?? null, updatedAt: now },
        });
    },

    async resetIfAt(name, key) {
      // 行が無ければreadは先頭を返すため、更新日時の要らない削除で先頭へ戻す。照合キーと同じく大文字小文字を区別せずに比べる
      await db
        .delete(emailCleanupCursors)
        .where(
          and(
            eq(emailCleanupCursors.name, name),
            sql`${emailCleanupCursors.afterKey} = ${key} COLLATE NOCASE`,
          ),
        );
    },
  };
}
