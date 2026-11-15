import { asc, eq, isNull, and } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { userProfileWebsites } from '../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  ProfileExport,
  ProfileExportRecord,
} from '../../core/profile/ports.ts';

@injectable()
export class D1ProfileExport implements ProfileExport {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async find(userId: string): Promise<ProfileExportRecord | undefined> {
    const [row] = await this.db
      .select({
        handle: users.handle,
        nickname: users.nickname,
        registeredAt: users.createdAt,
        headline: userProfiles.headline,
        bioMarkdown: userProfiles.bioMarkdown,
        avatarFileId: userProfiles.avatarFileId,
        profileUpdatedAt: userProfiles.updatedAt,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    if (row === undefined) {
      return undefined;
    }
    const websites = await this.db
      .select({ name: userProfileWebsites.name, url: userProfileWebsites.url })
      .from(userProfileWebsites)
      .where(eq(userProfileWebsites.userId, userId))
      .orderBy(asc(userProfileWebsites.position));
    return {
      handle: row.handle,
      nickname: row.nickname,
      headline: row.headline,
      bioMarkdown: row.bioMarkdown,
      avatarFileId: row.avatarFileId,
      websites: websites.map((website) => ({
        name: website.name ?? '',
        url: website.url,
      })),
      updatedAt: row.profileUpdatedAt ?? row.registeredAt,
    };
  }
}
