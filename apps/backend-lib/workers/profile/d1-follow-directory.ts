import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userFollows } from '../../../db/schema/follow/user-follows.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { visibleUsers } from '../../../db/schema/identity/visibility.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { AppError } from '../../core/errors/app-error.ts';
import type {
  FollowerDirectory,
  FollowExport,
  FollowExportEntry,
} from '../../core/profile/ports.ts';

const FOLLOWER_PAGE_MAX_LIMIT = 500;

function invalidLimit(): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'invalid_limit',
    message: `件数は1以上${String(FOLLOWER_PAGE_MAX_LIMIT)}以下の整数で指定してください。`,
  });
}

@injectable()
export class D1FollowDirectory implements FollowExport, FollowerDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listFollowing(userId: string): Promise<readonly FollowExportEntry[]> {
    return this.db
      .select({
        handle: users.handle,
        nickname: users.nickname,
        followedAt: userFollows.createdAt,
      })
      .from(userFollows)
      .innerJoin(users, eq(users.id, userFollows.followeeId))
      .where(
        and(
          eq(userFollows.followerId, userId),
          isNull(userFollows.deletedAt),
          visibleUsers(),
        ),
      )
      .orderBy(desc(userFollows.createdAt), desc(userFollows.id));
  }

  async listVisibleFollowerIds(input: {
    readonly after: string | undefined;
    readonly followeeId: string;
    readonly limit: number;
  }): Promise<{
    readonly followerIds: readonly string[];
    readonly next: string | undefined;
  }> {
    const { after, followeeId, limit } = input;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > FOLLOWER_PAGE_MAX_LIMIT
    ) {
      throw invalidLimit();
    }
    // 1件多く読み、続きがあるかを次の呼び出しを待たずに判定する
    const rows = await this.db
      .select({ followId: userFollows.id, followerId: userFollows.followerId })
      .from(userFollows)
      .innerJoin(users, eq(users.id, userFollows.followerId))
      .where(
        and(
          eq(userFollows.followeeId, followeeId),
          isNull(userFollows.deletedAt),
          visibleUsers(),
          after === undefined ? undefined : gt(userFollows.id, after),
        ),
      )
      .orderBy(asc(userFollows.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      followerIds: page.map((row) => row.followerId),
      next: rows.length > limit ? page.at(-1)?.followId : undefined,
    };
  }
}
