import { userFollows } from '../../../../db/schema/follow/user-follows.ts';
import { userProfileWebsites } from '../../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../../db/schema/profile/user-profiles.ts';
import {
  clearIdentityTables,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../identity/testing/identity-store-fixtures.ts';

export const ALICE_ID = userIdOf(1);
export const BOB_ID = userIdOf(2);

const FOLLOW_ID = '01JC0FLW000000000000000901';

export async function clearProfilePlatformTables(): Promise<void> {
  await db.delete(userFollows);
  await db.delete(userProfileWebsites);
  await db.delete(userProfiles);
  await clearIdentityTables();
}

// AliceがBobをフォローしている状態と、Aliceのプロフィール(外部Webサイト1件)を作る
export async function seedProfilePlatformSample(): Promise<void> {
  await insertUser(1, { handle: 'Alice', nickname: 'アリス' });
  await insertUser(2, { handle: 'bob', nickname: 'ボブ' });
  await db.insert(userProfiles).values({
    id: '01JC0PROF000000000000000901',
    userId: ALICE_ID,
    headline: '個人開発者',
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(userProfileWebsites).values({
    id: '01JC0WEB0000000000000000901',
    userId: ALICE_ID,
    position: 0,
    name: 'GitHub',
    url: 'https://github.example/alice',
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(userFollows).values({
    id: FOLLOW_ID,
    followerId: ALICE_ID,
    followeeId: BOB_ID,
    createdAt: T0,
    updatedAt: T0,
  });
}
