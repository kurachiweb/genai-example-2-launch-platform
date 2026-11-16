import { inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  CommentDepth,
  CommentRecord,
  CommentStore,
} from '../../core/engagement/ports.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

type CommentRow = typeof launchComments.$inferSelect;

// 階層はテーブルのCHECK制約で1〜3に限られる
function toCommentRecord(row: CommentRow): CommentRecord {
  return {
    commentId: row.id,
    productId: row.productId,
    launchId: row.launchId,
    parentId: row.parentId,
    rootId: row.rootId,
    depth: row.depth as CommentDepth,
    authorUserId: row.authorUserId,
    bodyMarkdown: row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    hiddenAt: row.hiddenAt,
    anonymizedAt: row.anonymizedAt,
  };
}

@injectable()
export class D1CommentStore implements CommentStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findByIds(
    commentIds: readonly string[],
  ): Promise<ReadonlyMap<string, CommentRecord>> {
    const pages = await Promise.all(
      chunk([...new Set(commentIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select()
          .from(launchComments)
          .where(inArray(launchComments.id, page)),
      ),
    );
    return new Map(pages.flat().map((row) => [row.id, toCommentRecord(row)]));
  }
}
