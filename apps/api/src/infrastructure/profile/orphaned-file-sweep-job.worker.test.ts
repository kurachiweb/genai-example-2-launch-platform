import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import type {
  MediaFiles,
  OwnerIdListInput,
  OwnerRef,
} from '../../../lib/core/media/ports.ts';
import {
  after,
  clearIdentityTables,
  db,
  insertUser,
  insertUsers,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { D1ProfileStore } from './d1-profile-store.ts';
import { OrphanedFileSweepJob } from '../../application/profile/jobs/orphaned-file-sweep-job.ts';

const ACTIVE = 1;
const WITHDRAWN = 2;

const GHOST_A = 50;
const GHOST_B = 51;
const GHOST_C = 200;

function createMediaFiles(filesByOwner: Map<string, number>) {
  const erased: string[] = [];
  const media = {
    listOwnerIds(input: OwnerIdListInput) {
      const owners = [...filesByOwner.keys()]
        .filter((id) => input.after === undefined || id > input.after)
        .toSorted();
      const page = owners.slice(0, input.limit);
      return Promise.resolve({
        ownerIds: page,
        next: owners.length > page.length ? page.at(-1) : undefined,
      });
    },
    eraseOwnedBy(owner: OwnerRef) {
      erased.push(owner.id);
      const processed = filesByOwner.get(owner.id) ?? 0;
      filesByOwner.delete(owner.id);
      return Promise.resolve({ processed, hasMore: false });
    },
  } as unknown as MediaFiles;
  return { media, erased };
}

beforeEach(async () => {
  await db.delete(userProfiles);
  await clearIdentityTables();
  await insertUser(ACTIVE);
  await insertUser(WITHDRAWN);
  await db
    .update(users)
    .set({ deletedAt: after(1) })
    .where(eq(users.id, userIdOf(WITHDRAWN)));
});

describe('保有者の居ないファイルの削除(ローカルD1と模擬のMediaFiles)', () => {
  test('usersに行の無い保有者のファイルだけを削除し、存在する利用者と退会済みで物理削除前の利用者のファイルは残す', async () => {
    const files = new Map([
      [userIdOf(ACTIVE), 2],
      [userIdOf(WITHDRAWN), 3],
      [userIdOf(GHOST_A), 4],
      [userIdOf(GHOST_B), 5],
    ]);
    const { media, erased } = createMediaFiles(files);
    const job = new OrphanedFileSweepJob(media, new D1ProfileStore(db));

    const result = await job.sweep();

    expect(erased).toEqual([userIdOf(GHOST_A), userIdOf(GHOST_B)]);
    expect([...files.keys()].toSorted()).toEqual([
      userIdOf(ACTIVE),
      userIdOf(WITHDRAWN),
    ]);
    expect(result).toEqual({
      ownersScanned: 4,
      orphanOwners: 2,
      failedOwners: 0,
      filesErased: 9,
      truncated: false,
    });
  });

  test('保有者が90件を超えても、ページをまたいで存在しない利用者だけを削除する', async () => {
    const existingIndexes = Array.from({ length: 150 }, (_, i) => i + 300);
    await insertUsers(existingIndexes);
    const files = new Map<string, number>([
      ...existingIndexes.map((index) => [userIdOf(index), 1] as const),
      [userIdOf(GHOST_A), 1],
      [userIdOf(GHOST_C), 1],
    ]);
    const { media, erased } = createMediaFiles(files);
    const job = new OrphanedFileSweepJob(media, new D1ProfileStore(db));

    const result = await job.sweep();

    expect(erased.toSorted()).toEqual(
      [userIdOf(GHOST_A), userIdOf(GHOST_C)].toSorted(),
    );
    expect(files.size).toBe(150);
    expect(result).toMatchObject({
      ownersScanned: 152,
      orphanOwners: 2,
      filesErased: 2,
      truncated: false,
    });
  });

  test('存在しない保有者が居なければ何も削除しない', async () => {
    const files = new Map([[userIdOf(ACTIVE), 2]]);
    const { media, erased } = createMediaFiles(files);
    const job = new OrphanedFileSweepJob(media, new D1ProfileStore(db));

    const result = await job.sweep();

    expect(erased).toEqual([]);
    expect(result.filesErased).toBe(0);
  });
});
