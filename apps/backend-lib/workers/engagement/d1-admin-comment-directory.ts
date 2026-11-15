import { and, desc, eq, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { visibleUsers } from '../../../db/schema/identity/visibility.ts';
import { truncateGraphemes } from '../../../common-lib/text/graphemes.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  AdminCommentDirectory,
  AdminCommentRecord,
  AdminCommentSearchFilter,
  AdminCommentState,
  AdminDirectoryPage,
} from '../../core/engagement/ports.ts';
import { afterCursor, assertPageSize, toPage } from './admin-directory-page.ts';

const EXCERPT_GRAPHEMES = 200;

// 優先の順に並べたCASEで1つの状態に決め、返す状態と絞り込みに同じ式を使う。投稿者の紐付けが外れた行は外部結合のusersがNULLになり投稿者が利用できない状態になる
function commentState(): SQL<AdminCommentState> {
  return sql<AdminCommentState>`case
    when ${isNotNull(launchComments.hiddenAt)} then 'hidden'
    when ${isNotNull(launchComments.deletedAt)} then 'deleted'
    when ${isNotNull(launchComments.anonymizedAt)} then 'anonymized'
    when ${visibleUsers()} then 'shown'
    else 'author_unavailable'
  end`;
}

function filterConditions(filter: AdminCommentSearchFilter): SQL | undefined {
  return and(
    filter.authorUserId === undefined
      ? undefined
      : eq(launchComments.authorUserId, filter.authorUserId),
    filter.productId === undefined
      ? undefined
      : eq(launchComments.productId, filter.productId),
    filter.postedFrom === undefined
      ? undefined
      : gte(launchComments.createdAt, filter.postedFrom),
    filter.postedBefore === undefined
      ? undefined
      : lt(launchComments.createdAt, filter.postedBefore),
    filter.state === undefined
      ? undefined
      : sql`${commentState()} = ${filter.state}`,
  );
}

interface CommentRow {
  readonly commentId: string;
  readonly productId: string;
  readonly launchId: string;
  readonly authorUserId: string | null;
  readonly body: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly anonymizedAt: Date | null;
  readonly state: AdminCommentState;
}

function toRecord(row: CommentRow): AdminCommentRecord {
  return {
    commentId: row.commentId,
    productId: row.productId,
    launchId: row.launchId,
    authorUserId: row.authorUserId,
    excerpt:
      row.anonymizedAt === null
        ? truncateGraphemes(row.body, EXCERPT_GRAPHEMES)
        : '',
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    state: row.state,
  };
}

@injectable()
export class D1AdminCommentDirectory implements AdminCommentDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async search(
    filter: AdminCommentSearchFilter,
    page: AdminDirectoryPage,
  ): Promise<{
    readonly comments: readonly AdminCommentRecord[];
    readonly nextCursor: string | null;
  }> {
    assertPageSize(page.limit);
    const rows: CommentRow[] = await this.db
      .select({
        commentId: launchComments.id,
        productId: launchComments.productId,
        launchId: launchComments.launchId,
        authorUserId: launchComments.authorUserId,
        body: launchComments.body,
        createdAt: launchComments.createdAt,
        editedAt: launchComments.editedAt,
        anonymizedAt: launchComments.anonymizedAt,
        state: commentState(),
      })
      .from(launchComments)
      .leftJoin(users, eq(users.id, launchComments.authorUserId))
      .where(
        and(
          filterConditions(filter),
          afterCursor(
            { at: launchComments.createdAt, id: launchComments.id },
            page.after,
          ),
        ),
      )
      .orderBy(desc(launchComments.createdAt), desc(launchComments.id))
      .limit(page.limit + 1);
    const { rows: pageRows, nextCursor } = toPage(rows, page, (row) => ({
      at: row.createdAt,
      id: row.commentId,
    }));
    return { comments: pageRows.map(toRecord), nextCursor };
  }
}
