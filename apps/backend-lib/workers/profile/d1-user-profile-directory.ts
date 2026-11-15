import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { visibleUsers } from '../../../db/schema/identity/visibility.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  UserHandleResolution,
  UserLookupScope,
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../core/profile/ports.ts';
import { resolveHandle } from '../handles/handle-queries.ts';
import { USER_HANDLE_NAMESPACE } from './user-handle-namespace.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function scopeCondition(scope: UserLookupScope): SQL | undefined {
  switch (scope) {
    case 'visible':
      return visibleUsers();
    case 'not-withdrawn':
      return isNull(users.deletedAt);
    case 'including-withdrawn':
      return undefined;
  }
}

@injectable()
export class D1UserProfileDirectory implements UserProfileDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findSummaries(
    userIds: readonly string[],
    scope: UserLookupScope,
  ): Promise<ReadonlyMap<string, UserSummaryRecord>> {
    const condition = scopeCondition(scope);
    const pages = await Promise.all(
      chunk([...new Set(userIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            userId: users.id,
            handle: users.handle,
            nickname: users.nickname,
            status: users.status,
            avatarFileId: userProfiles.avatarFileId,
          })
          .from(users)
          .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
          .where(and(inArray(users.id, page), condition)),
      ),
    );
    return new Map(
      pages.flat().map((row) => [
        row.userId,
        {
          userId: row.userId,
          handle: row.handle,
          nickname: row.nickname,
          avatarFileId: row.avatarFileId,
          suspended: row.status === 'suspended',
        },
      ]),
    );
  }

  async resolveHandle(handle: string): Promise<UserHandleResolution> {
    const resolution = await resolveHandle(
      this.db,
      USER_HANDLE_NAMESPACE,
      handle,
    );
    if (resolution.kind === 'none') {
      return resolution;
    }
    const found = await this.findSummaries(
      [resolution.ownerId],
      'not-withdrawn',
    );
    const user = found.get(resolution.ownerId);
    return user === undefined
      ? { kind: 'none' }
      : { kind: resolution.kind, user };
  }
}
