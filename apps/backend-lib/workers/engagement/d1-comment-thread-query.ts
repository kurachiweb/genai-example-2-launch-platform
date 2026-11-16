import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lt,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { displayableComment } from '../../../db/schema/engagement/engagement-conditions.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { COMMENT_PAGE_SIZE } from '../../../common-lib/engagement/engagement-rules.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  CommentDepth,
  CommentRow,
  CommentThreadPage,
  CommentThreadPageInput,
  CommentThreadQuery,
} from '../../core/engagement/ports.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

const TOP_LEVEL_DEPTH = 1;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

interface TopLevelColumns {
  readonly id: SQLiteColumn;
  readonly launchId: SQLiteColumn;
  readonly depth: SQLiteColumn;
  readonly createdAt: SQLiteColumn;
}

function afterCursor(
  table: TopLevelColumns,
  after: CommentThreadPageInput['after'],
): SQL | undefined {
  if (after === undefined) {
    return undefined;
  }
  const createdAt = new Date(after.createdAt);
  return or(
    lt(table.createdAt, createdAt),
    and(eq(table.createdAt, createdAt), lt(table.id, after.commentId)),
  );
}

function topLevelOf(
  table: TopLevelColumns,
  input: CommentThreadPageInput,
): SQL | undefined {
  return and(
    eq(table.launchId, input.launchId),
    eq(table.depth, TOP_LEVEL_DEPTH),
    afterCursor(table, input.after),
  );
}

// 置き換え表示の行は本文・投稿者・日時をデータベースから読み出さない
function threadColumns() {
  const shown = displayableComment();
  const whenShown = <T>(value: SQLWrapper) =>
    sql<T | null>`case when ${shown} then ${value} end`;
  return {
    commentId: launchComments.id,
    parentId: launchComments.parentId,
    rootId: launchComments.rootId,
    depth: launchComments.depth,
    authorUserId: whenShown<string>(launchComments.authorUserId),
    bodyMarkdown: whenShown<string>(launchComments.body),
    createdAt: whenShown<number>(launchComments.createdAt),
    edited: whenShown<number>(sql`${launchComments.editedAt} is not null`),
  };
}

interface ThreadRow {
  readonly commentId: string;
  readonly parentId: string | null;
  readonly rootId: string;
  readonly depth: number;
  readonly authorUserId: string | null;
  readonly bodyMarkdown: string | null;
  readonly createdAt: number | null;
  readonly edited: number | null;
}

// 階層はテーブルのCHECK制約で1〜3に限られる
function toCommentRow(row: ThreadRow): CommentRow {
  const position = {
    commentId: row.commentId,
    parentId: row.parentId,
    depth: row.depth as CommentDepth,
  };
  if (
    row.authorUserId === null ||
    row.bodyMarkdown === null ||
    row.createdAt === null
  ) {
    return { kind: 'removed', ...position };
  }
  return {
    kind: 'shown',
    ...position,
    authorUserId: row.authorUserId,
    bodyMarkdown: row.bodyMarkdown,
    createdAt: new Date(row.createdAt),
    edited: row.edited === 1,
  };
}

@injectable()
export class D1CommentThreadQuery implements CommentThreadQuery {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async page(input: CommentThreadPageInput): Promise<CommentThreadPage> {
    const columns = threadColumns();
    const pageRoots = alias(launchComments, 'page_roots');
    const [rootRows, replyRows] = await this.db.batch([
      this.db
        .select(columns)
        .from(launchComments)
        .leftJoin(users, eq(users.id, launchComments.authorUserId))
        .where(topLevelOf(launchComments, input))
        .orderBy(desc(launchComments.createdAt), desc(launchComments.id))
        .limit(COMMENT_PAGE_SIZE + 1),
      // トップレベルもroot_idに自身のIDを持つため、階層で返信だけに絞る
      this.db
        .select(columns)
        .from(launchComments)
        .leftJoin(users, eq(users.id, launchComments.authorUserId))
        .where(
          and(
            inArray(
              launchComments.rootId,
              this.db
                .select({ id: pageRoots.id })
                .from(pageRoots)
                .where(topLevelOf(pageRoots, input))
                .orderBy(desc(pageRoots.createdAt), desc(pageRoots.id))
                .limit(COMMENT_PAGE_SIZE),
            ),
            gt(launchComments.depth, TOP_LEVEL_DEPTH),
          ),
        )
        .orderBy(asc(launchComments.createdAt), asc(launchComments.id)),
    ]);
    const repliesOf = Map.groupBy(replyRows, (row) => row.rootId);
    return {
      threads: rootRows.slice(0, COMMENT_PAGE_SIZE).map((root) => ({
        root: toCommentRow(root),
        replies: (repliesOf.get(root.commentId) ?? []).map(toCommentRow),
      })),
      hasNextPage: rootRows.length > COMMENT_PAGE_SIZE,
    };
  }

  async countsByLaunch(
    productId: string,
  ): Promise<ReadonlyMap<string, number>> {
    const rows = await this.db
      .select({ launchId: launchComments.launchId, count: count() })
      .from(launchComments)
      .leftJoin(users, eq(users.id, launchComments.authorUserId))
      .where(and(eq(launchComments.productId, productId), displayableComment()))
      .groupBy(launchComments.launchId);
    return new Map(rows.map((row) => [row.launchId, row.count]));
  }

  async countsByProduct(
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    const pages = await Promise.all(
      chunk([...new Set(productIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({ productId: launchComments.productId, count: count() })
          .from(launchComments)
          .leftJoin(users, eq(users.id, launchComments.authorUserId))
          .where(
            and(inArray(launchComments.productId, page), displayableComment()),
          )
          .groupBy(launchComments.productId),
      ),
    );
    return new Map(pages.flat().map((row) => [row.productId, row.count]));
  }
}
