import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userFollows } from '../../../db/schema/follow/user-follows.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { visibleUsers } from '../../../db/schema/identity/visibility.ts';
import { userProfileWebsites } from '../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  PublicProfileRecord,
  PublicProfileStore,
} from '../../application/profile/ports.ts';

@injectable()
export class D1PublicProfileStore implements PublicProfileStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 人物情報・外部Webサイト・可視のフォロワー数は1回のbatchで読む。閲覧者のフォローの有無は人物情報の行の相関サブクエリで読み、閲覧者がいなければ常に偽にする
  async load(
    userId: string,
    viewerUserId: string | undefined,
  ): Promise<PublicProfileRecord | undefined> {
    const [userRows, websiteRows, followerRows] = await this.db.batch([
      this.db
        .select({
          handle: users.handle,
          nickname: users.nickname,
          status: users.status,
          headline: userProfiles.headline,
          bioMarkdown: userProfiles.bioMarkdown,
          avatarFileId: userProfiles.avatarFileId,
          viewerFollows: sql<boolean>`exists (
            select 1 from ${userFollows}
            where ${userFollows.followerId} = ${viewerUserId ?? null}
              and ${userFollows.followeeId} = ${users.id}
              and ${isNull(userFollows.deletedAt)}
          )`.mapWith(Boolean),
        })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(and(eq(users.id, userId), isNull(users.deletedAt))),
      this.db
        .select({
          name: userProfileWebsites.name,
          url: userProfileWebsites.url,
        })
        .from(userProfileWebsites)
        .where(eq(userProfileWebsites.userId, userId))
        .orderBy(asc(userProfileWebsites.position)),
      this.db
        .select({ followers: count() })
        .from(userFollows)
        .innerJoin(users, eq(users.id, userFollows.followerId))
        .where(
          and(
            eq(userFollows.followeeId, userId),
            isNull(userFollows.deletedAt),
            visibleUsers(),
          ),
        ),
    ]);
    const [user] = userRows;
    if (user === undefined) {
      return undefined;
    }
    return {
      handle: user.handle,
      nickname: user.nickname,
      headline: user.headline,
      bioMarkdown: user.bioMarkdown,
      avatarFileId: user.avatarFileId,
      websites: websiteRows,
      followerCount: followerRows[0]?.followers ?? 0,
      suspended: user.status === 'suspended',
      viewerFollows: user.viewerFollows,
    };
  }
}
