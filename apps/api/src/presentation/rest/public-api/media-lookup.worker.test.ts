import { beforeEach, describe, expect, test } from 'vitest';

import { userProfiles } from '../../../../db/schema/profile/user-profiles.ts';
import { MEDIA_TYPES } from '../../../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../../../lib/core/media/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../../lib/core/profile/identifiers.ts';
import type {
  UserLookupScope,
  UserProfileDirectory,
} from '../../../../lib/core/profile/ports.ts';
import {
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  clearMediaTables,
  fileIdOf,
  insertFile,
} from '../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { clearProfilePlatformTables } from '../../../../lib/workers/profile/testing/profile-platform-fixtures.ts';
import { createPublicApiTestContainer } from '../../../../test/support/public-api-rest-harness.ts';
import { PUBLIC_API_TYPES } from '../../../application/public-api/public-api-types.ts';
import { type MediaLookup, PlatformMediaLookup } from './media-lookup.ts';

const ALICE = 1;
const BOB = 2;
const SUSPENDED = 3;
const MISSING = 9;

const ALICE_AVATAR = 11;
const BOB_AVATAR = 12;
const SUSPENDED_AVATAR = 13;
const LOGO = 21;
const SCREENSHOT = 22;
const MISSING_FILE = 99;

interface Calls {
  readonly summaries: {
    readonly ids: readonly string[];
    readonly scope: UserLookupScope;
  }[];
  readonly files: (readonly string[])[];
}

// 実際の照会へ渡しつつ、呼び出しの回数と引数を記録する
function createCountingLookup(): {
  readonly lookup: MediaLookup;
  readonly calls: Calls;
} {
  const container = createPublicApiTestContainer();
  const files = container.get<MediaFiles>(MEDIA_TYPES.MediaFiles);
  const users = container.get<UserProfileDirectory>(
    PROFILE_PLATFORM_TYPES.UserProfileDirectory,
  );
  const calls: Calls = { summaries: [], files: [] };
  const countingFiles = {
    findMany: (ids: readonly string[]) => {
      calls.files.push([...ids]);
      return files.findMany(ids);
    },
  } as Pick<MediaFiles, 'findMany'> as MediaFiles;
  const countingUsers: UserProfileDirectory = {
    findSummaries: (ids, scope) => {
      calls.summaries.push({ ids: [...ids], scope });
      return users.findSummaries(ids, scope);
    },
    resolveHandle: (handle) => users.resolveHandle(handle),
  };
  return {
    lookup: new PlatformMediaLookup(countingFiles, countingUsers),
    calls,
  };
}

async function insertAvatar(userIndex: number, fileIndex: number) {
  await db.insert(userProfiles).values({
    id: `01JC0PR0F${String(userIndex).padStart(17, '0')}`,
    userId: userIdOf(userIndex),
    avatarFileId: fileIdOf(fileIndex),
    createdAt: T0,
    updatedAt: T0,
  });
}

beforeEach(async () => {
  await clearProfilePlatformTables();
  await clearMediaTables();
  for (const index of [
    ALICE_AVATAR,
    BOB_AVATAR,
    SUSPENDED_AVATAR,
    LOGO,
    SCREENSHOT,
  ]) {
    await insertFile(index);
  }
  await insertUser(ALICE, { handle: 'alice' });
  await insertUser(BOB, { handle: 'bob' });
  await insertUser(SUSPENDED, {
    handle: 'suspended',
    emailVerifiedAt: T0,
    status: 'suspended',
    suspendedAt: T0,
  });
  await insertAvatar(ALICE, ALICE_AVATAR);
  await insertAvatar(BOB, BOB_AVATAR);
  await insertAvatar(SUSPENDED, SUSPENDED_AVATAR);
});

describe('写像に必要な画像と利用者の一括の照会', () => {
  test('公開APIの束縛から照会を解決できる', () => {
    expect(
      createPublicApiTestContainer().get(PUBLIC_API_TYPES.MediaLookup),
    ).toBeInstanceOf(PlatformMediaLookup);
  });

  test('利用者を可視の範囲で1回、画像を指定の画像と利用者のプロフィール画像を合わせて1回だけ読む', async () => {
    const { lookup, calls } = createCountingLookup();

    const loaded = await lookup.load({
      fileIds: [fileIdOf(LOGO), fileIdOf(SCREENSHOT), fileIdOf(LOGO)],
      userIds: [
        userIdOf(ALICE),
        userIdOf(BOB),
        userIdOf(SUSPENDED),
        userIdOf(MISSING),
        userIdOf(ALICE),
      ],
    });

    expect(calls.summaries).toEqual([
      {
        ids: [
          userIdOf(ALICE),
          userIdOf(BOB),
          userIdOf(SUSPENDED),
          userIdOf(MISSING),
        ],
        scope: 'visible',
      },
    ]);
    expect(calls.files).toHaveLength(1);
    expect([...(calls.files[0] ?? [])].sort()).toEqual(
      [
        fileIdOf(LOGO),
        fileIdOf(SCREENSHOT),
        fileIdOf(ALICE_AVATAR),
        fileIdOf(BOB_AVATAR),
      ].sort(),
    );
    expect([...loaded.users.keys()].sort()).toEqual(
      [userIdOf(ALICE), userIdOf(BOB)].sort(),
    );
    expect(loaded.users.get(userIdOf(ALICE))).toMatchObject({
      handle: 'alice',
      avatarFileId: fileIdOf(ALICE_AVATAR),
    });
    expect([...loaded.files.keys()].sort()).toEqual(
      [
        fileIdOf(LOGO),
        fileIdOf(SCREENSHOT),
        fileIdOf(ALICE_AVATAR),
        fileIdOf(BOB_AVATAR),
      ].sort(),
    );
  });

  test('項目の数が増えても、利用者と画像の照会はそれぞれ1回のまま', async () => {
    const { lookup, calls } = createCountingLookup();

    await lookup.load({
      fileIds: [fileIdOf(LOGO), fileIdOf(SCREENSHOT), fileIdOf(MISSING_FILE)],
      userIds: [userIdOf(ALICE)],
    });
    await lookup.load({
      fileIds: [fileIdOf(LOGO)],
      userIds: [userIdOf(ALICE), userIdOf(BOB), userIdOf(SUSPENDED)],
    });

    expect(calls.summaries).toHaveLength(2);
    expect(calls.files).toHaveLength(2);
  });

  test('利用者を指定しなければ利用者を読まず、画像も指定しなければ何も読まない', async () => {
    const { lookup, calls } = createCountingLookup();

    const onlyFiles = await lookup.load({
      fileIds: [fileIdOf(LOGO)],
      userIds: [],
    });
    const nothing = await lookup.load({ fileIds: [], userIds: [] });

    expect(calls.summaries).toEqual([]);
    expect(calls.files).toEqual([[fileIdOf(LOGO)]]);
    expect([...onlyFiles.files.keys()]).toEqual([fileIdOf(LOGO)]);
    expect(onlyFiles.users.size).toBe(0);
    expect(nothing.files.size).toBe(0);
    expect(nothing.users.size).toBe(0);
  });
});
