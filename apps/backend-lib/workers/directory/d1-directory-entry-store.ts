import { and, asc, eq, gt } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { directoryEntries } from '../../../db/schema/directory/directory-entries.ts';
import { productSearchDocuments } from '../../../db/schema/directory/product-search-documents.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  DirectoryEntry,
  DirectoryEntryStore,
} from '../../core/directory/ports.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';

// 1行が6個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const ROWS_PER_INSERT = 15;

type EntryRow = typeof directoryEntries.$inferInsert;

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class D1DirectoryEntryStore implements DirectoryEntryStore {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  // 重複配信と2回目以降の勝利で最初の勝利の日時を上書きしないよう、記録済みのプロダクトは無視する
  async record(entries: readonly DirectoryEntry[], at: Date): Promise<void> {
    const rows = entries.map((entry): EntryRow => ({
      id: this.ids.generate(),
      productId: entry.productId,
      ownerUserId: entry.ownerUserId,
      firstWonAt: at,
      createdAt: at,
      updatedAt: at,
    }));
    const [first, ...rest] = chunksOf(rows, ROWS_PER_INSERT).map((chunk) =>
      this.db
        .insert(directoryEntries)
        .values(chunk)
        .onConflictDoNothing({ target: directoryEntries.productId }),
    );
    if (first === undefined) {
      return;
    }
    await this.db.batch([first, ...rest]);
  }

  async exists(productId: string): Promise<boolean> {
    const rows = await this.db
      .select({ productId: directoryEntries.productId })
      .from(directoryEntries)
      .where(eq(directoryEntries.productId, productId))
      .limit(1);
    return rows.length > 0;
  }

  async listProductIdsByOwner(
    ownerUserId: string,
    after: string | undefined,
    limit: number,
  ): Promise<readonly string[]> {
    const rows = await this.db
      .select({ productId: directoryEntries.productId })
      .from(directoryEntries)
      .where(
        and(
          eq(directoryEntries.ownerUserId, ownerUserId),
          after === undefined
            ? undefined
            : gt(directoryEntries.productId, after),
        ),
      )
      .orderBy(asc(directoryEntries.productId))
      .limit(limit);
    return rows.map((row) => row.productId);
  }

  // 索引文書はプロダクトを外部キーで参照しないため、記録と同じ一括の書き込みで消してプロダクトの物理削除の後に残さない
  async erase(productId: string): Promise<void> {
    await this.db.batch([
      this.db
        .delete(productSearchDocuments)
        .where(eq(productSearchDocuments.sourceId, productId)),
      this.db
        .delete(directoryEntries)
        .where(eq(directoryEntries.productId, productId)),
    ]);
  }
}
