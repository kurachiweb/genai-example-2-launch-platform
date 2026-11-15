import { eq, or } from 'drizzle-orm';

import { userFollows } from '../../../../db/schema/follow/user-follows.ts';
import { userPreviousHandles } from '../../../../db/schema/profile/user-previous-handles.ts';
import { userProfileWebsites } from '../../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../../db/schema/profile/user-profiles.ts';
import {
  db,
  T0,
  userIdOf,
} from '../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { clearProfilePlatformTables } from '../../../../lib/workers/profile/testing/profile-platform-fixtures.ts';

const FOLLOWS_PER_INSERT = 10;

export function followIdOf(index: number): string {
  return `01JC0FLW${String(index).padStart(18, '0')}`;
}

export async function resetProfilePurgeRows(): Promise<void> {
  await db.delete(userPreviousHandles);
  await clearProfilePlatformTables();
}

export interface FollowRowInput {
  readonly index: number;
  readonly followerIndex: number;
  readonly followeeIndex: number;
  readonly deletedAt?: Date;
}

export async function insertFollows(
  inputs: readonly FollowRowInput[],
): Promise<void> {
  const rows = inputs.map((input) => ({
    id: followIdOf(input.index),
    followerId: userIdOf(input.followerIndex),
    followeeId: userIdOf(input.followeeIndex),
    createdAt: T0,
    updatedAt: T0,
    deletedAt: input.deletedAt ?? null,
  }));
  for (let start = 0; start < rows.length; start += FOLLOWS_PER_INSERT) {
    await db
      .insert(userFollows)
      .values(rows.slice(start, start + FOLLOWS_PER_INSERT));
  }
}

export async function insertProfileRows(userIndex: number): Promise<void> {
  const suffix = String(userIndex).padStart(2, '0');
  await db.insert(userProfiles).values({
    id: `01JC0PROF${suffix.padStart(17, '0')}`,
    userId: userIdOf(userIndex),
    headline: `見出し${suffix}`,
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(userProfileWebsites).values({
    id: `01JC0WEB0${suffix.padStart(17, '0')}`,
    userId: userIdOf(userIndex),
    position: 0,
    name: 'サイト',
    url: `https://site${suffix}.example/`,
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(userPreviousHandles).values({
    id: `01JC0PHD0${suffix.padStart(17, '0')}`,
    ownerId: userIdOf(userIndex),
    handle: `old${suffix}`,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: T0,
  });
}

export async function readFollowIdsOf(
  userIndex: number,
): Promise<readonly string[]> {
  const userId = userIdOf(userIndex);
  const rows = await db
    .select({ id: userFollows.id })
    .from(userFollows)
    .where(
      or(
        eq(userFollows.followerId, userId),
        eq(userFollows.followeeId, userId),
      ),
    )
    .orderBy(userFollows.id);
  return rows.map((row) => row.id);
}

export interface ProfileRowCounts {
  readonly profiles: number;
  readonly websites: number;
  readonly previousHandles: number;
}

export async function readProfileRowCounts(
  userIndex: number,
): Promise<ProfileRowCounts> {
  const userId = userIdOf(userIndex);
  const [profiles, websites, previousHandles] = await Promise.all([
    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)),
    db
      .select()
      .from(userProfileWebsites)
      .where(eq(userProfileWebsites.userId, userId)),
    db
      .select()
      .from(userPreviousHandles)
      .where(eq(userPreviousHandles.ownerId, userId)),
  ]);
  return {
    profiles: profiles.length,
    websites: websites.length,
    previousHandles: previousHandles.length,
  };
}
