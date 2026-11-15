import {
  and,
  count,
  desc,
  eq,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userFollows } from '../../../db/schema/follow/user-follows.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { visibleUsers } from '../../../db/schema/identity/visibility.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  FollowEntryView,
  FollowInsertInput,
  FollowListPosition,
  FollowListQuery,
  FollowStore,
} from '../../application/profile/ports.ts';

function afterPosition(
  position: FollowListPosition | undefined,
): SQL | undefined {
  if (position === undefined) {
    return undefined;
  }
  const createdAt = new Date(position.t);
  return or(
    lt(userFollows.createdAt, createdAt),
    and(eq(userFollows.createdAt, createdAt), lt(userFollows.id, position.id)),
  );
}

@injectable()
export class D1FollowStore implements FollowStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 相手が可視であることの判定と挿入を1つの文で行い、判定と挿入の間の停止・退会に挟まれない。組の重複は一意制約で無視し、論理削除済みの行がある組も変えない
  async insertIfAbsent(
    input: FollowInsertInput,
  ): Promise<'inserted' | 'exists' | 'target-unavailable'> {
    const { id, followerId, followeeId, now } = input;
    const result = await this.db.run(sql`
      insert into user_follows (id, follower_id, followee_id, created_at, updated_at)
      select ${id}, ${followerId}, ${followeeId}, ${now.getTime()}, ${now.getTime()}
      where exists (
        select 1 from ${users}
        where ${eq(users.id, followeeId)} and ${visibleUsers()}
      )
      on conflict (follower_id, followee_id) do nothing
    `);
    if (result.meta.changes > 0) {
      return 'inserted';
    }
    return (await this.isFollowing(followerId, followeeId))
      ? 'exists'
      : 'target-unavailable';
  }

  async delete(followerId: string, followeeId: string): Promise<void> {
    await this.db
      .delete(userFollows)
      .where(
        and(
          eq(userFollows.followerId, followerId),
          eq(userFollows.followeeId, followeeId),
        ),
      );
  }

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: userFollows.id })
      .from(userFollows)
      .where(
        and(
          eq(userFollows.followerId, followerId),
          eq(userFollows.followeeId, followeeId),
          isNull(userFollows.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async countVisibleFollowers(followeeId: string): Promise<number> {
    const [row] = await this.db
      .select({ followers: count() })
      .from(userFollows)
      .innerJoin(users, eq(users.id, userFollows.followerId))
      .where(
        and(
          eq(userFollows.followeeId, followeeId),
          isNull(userFollows.deletedAt),
          visibleUsers(),
        ),
      );
    return row?.followers ?? 0;
  }

  // 自分の側の列で絞った索引の順に読み、相手の側の利用者を結合の条件で可視に限る。1件多く読み、続きの有無を判定できるようにする
  async list(query: FollowListQuery): Promise<readonly FollowEntryView[]> {
    const { userId, direction, first, after } = query;
    const ownColumn =
      direction === 'following'
        ? userFollows.followerId
        : userFollows.followeeId;
    const otherColumn =
      direction === 'following'
        ? userFollows.followeeId
        : userFollows.followerId;
    const rows = await this.db
      .select({
        followId: userFollows.id,
        followedAt: userFollows.createdAt,
        userId: users.id,
        handle: users.handle,
        nickname: users.nickname,
        avatarFileId: userProfiles.avatarFileId,
      })
      .from(userFollows)
      .innerJoin(users, eq(users.id, otherColumn))
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(
        and(
          eq(ownColumn, userId),
          isNull(userFollows.deletedAt),
          visibleUsers(),
          afterPosition(after),
        ),
      )
      .orderBy(desc(userFollows.createdAt), desc(userFollows.id))
      .limit(first + 1);
    return rows.map((row) => ({
      followId: row.followId,
      followedAt: row.followedAt,
      user: {
        userId: row.userId,
        handle: row.handle,
        nickname: row.nickname,
        avatarFileId: row.avatarFileId,
        suspended: false,
      },
    }));
  }
}
