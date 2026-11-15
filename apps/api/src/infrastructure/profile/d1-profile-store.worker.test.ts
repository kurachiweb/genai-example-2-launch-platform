import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { userPreviousHandles } from '../../../db/schema/profile/user-previous-handles.ts';
import { userProfileWebsites } from '../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import { resolveHandle } from '../../../lib/workers/handles/handle-queries.ts';
import {
  insertPreviousHandle,
  readPreviousHandles,
} from '../../../lib/workers/handles/testing/handle-fixtures.ts';
import {
  after,
  clearIdentityTables,
  createFailingDatabase,
  createRecordingDatabase,
  db,
  expectSplitWithinBindLimit,
  insertUser,
  insertUsers,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { USER_HANDLE_NAMESPACE } from '../../../lib/workers/profile/user-handle-namespace.ts';
import type {
  ProfileSaveInput,
  ProfileStore,
} from '../../application/profile/ports.ts';
import { planProfileEdit } from '../../domain/profile/profile-edit-plan.ts';
import { D1ProfileStore } from './d1-profile-store.ts';

const ALICE = 1;
const BOB = 2;
const CAROL = 3;

const OLD_AVATAR = '01JC0FILE00000000000000001';
const NEW_AVATAR = '01JC0FILE00000000000000002';

const SAVED_AT = after(60_000);

function createStore(): ProfileStore {
  return new D1ProfileStore(db);
}

function saveInput(
  userIndex: number,
  overrides: Partial<ProfileSaveInput> & {
    readonly currentHandle: string;
    readonly currentAvatarFileId?: string | null;
  },
): ProfileSaveInput {
  const { currentHandle, currentAvatarFileId = null, ...rest } = overrides;
  const handle = rest.handle ?? currentHandle;
  const avatarFileId = rest.avatarFileId ?? currentAvatarFileId;
  return {
    userId: userIdOf(userIndex),
    expectedHandle: currentHandle,
    nickname: '新しいニックネーム',
    plan: planProfileEdit(
      { handle: currentHandle, avatarFileId: currentAvatarFileId },
      { handle, avatarFileId },
    ),
    handle,
    headline: '新しいヘッドライン',
    bioMarkdown: '**自己紹介**',
    avatarFileId,
    websites: [],
    now: SAVED_AT,
    ...rest,
  };
}

async function insertProfile(
  userIndex: number,
  columns: {
    readonly headline?: string | null;
    readonly bioMarkdown?: string | null;
    readonly avatarFileId?: string | null;
  } = {},
): Promise<void> {
  await db.insert(userProfiles).values({
    id: `01JC0PROF${String(userIndex).padStart(17, '0')}`,
    userId: userIdOf(userIndex),
    headline: columns.headline ?? null,
    bioMarkdown: columns.bioMarkdown ?? null,
    avatarFileId: columns.avatarFileId ?? null,
    createdAt: T0,
    updatedAt: T0,
  });
}

async function insertWebsite(
  userIndex: number,
  position: number,
  name: string | null,
  url: string,
): Promise<void> {
  await db.insert(userProfileWebsites).values({
    id: `01JC0WEB${String(userIndex * 100 + position).padStart(18, '0')}`,
    userId: userIdOf(userIndex),
    position,
    name,
    url,
    createdAt: T0,
    updatedAt: T0,
  });
}

async function readState() {
  return {
    users: await db.select().from(users).orderBy(asc(users.id)),
    profiles: await db
      .select()
      .from(userProfiles)
      .orderBy(asc(userProfiles.id)),
    websites: await db
      .select()
      .from(userProfileWebsites)
      .orderBy(
        asc(userProfileWebsites.userId),
        asc(userProfileWebsites.position),
      ),
    previous: await readPreviousHandles(),
  };
}

beforeEach(async () => {
  await db.delete(userProfileWebsites);
  await db.delete(userProfiles);
  await db.delete(userPreviousHandles);
  await clearIdentityTables();
  await insertUser(ALICE, { handle: 'Alice', nickname: 'アリス' });
  await insertUser(BOB, { handle: 'bob', nickname: 'ボブ' });
  await insertUser(CAROL, { handle: 'carol', nickname: 'キャロル' });
});

describe('findSnapshot', () => {
  test('プロフィールの行が無い利用者は空の項目で返す', async () => {
    const snapshot = await createStore().findSnapshot(userIdOf(ALICE));

    expect(snapshot).toEqual({
      userId: userIdOf(ALICE),
      nickname: 'アリス',
      handle: 'Alice',
      previousHandle: null,
      headline: null,
      bioMarkdown: null,
      avatarFileId: null,
      websites: [],
      suspended: false,
    });
  });

  test('プロフィール・位置の順の外部Webサイト・保持中の旧ハンドルを返す', async () => {
    await insertProfile(ALICE, {
      headline: '個人開発者',
      bioMarkdown: '自己紹介',
      avatarFileId: OLD_AVATAR,
    });
    await insertWebsite(ALICE, 1, null, 'https://b.example/');
    await insertWebsite(ALICE, 0, 'GitHub', 'https://github.example/alice');
    await insertPreviousHandle(1, ALICE, 'alice-old');

    const snapshot = await createStore().findSnapshot(userIdOf(ALICE));

    expect(snapshot).toMatchObject({
      headline: '個人開発者',
      bioMarkdown: '自己紹介',
      avatarFileId: OLD_AVATAR,
      previousHandle: 'alice-old',
      websites: [
        { name: 'GitHub', url: 'https://github.example/alice' },
        { name: null, url: 'https://b.example/' },
      ],
    });
  });

  test('論理削除済みの旧ハンドルは返さない', async () => {
    await insertPreviousHandle(1, ALICE, 'alice-old', { deletedAt: after(1) });

    const snapshot = await createStore().findSnapshot(userIdOf(ALICE));

    expect(snapshot?.previousHandle).toBeNull();
  });

  test('停止中の利用者は停止中として返す', async () => {
    await db
      .update(users)
      .set({ status: 'suspended', suspendedAt: after(1) })
      .where(eq(users.id, userIdOf(BOB)));

    const snapshot = await createStore().findSnapshot(userIdOf(BOB));

    expect(snapshot?.suspended).toBe(true);
  });

  test('退会済みの利用者と存在しない利用者はundefinedを返す', async () => {
    await db
      .update(users)
      .set({ deletedAt: after(1) })
      .where(eq(users.id, userIdOf(CAROL)));
    const store = createStore();

    expect(await store.findSnapshot(userIdOf(CAROL))).toBeUndefined();
    expect(await store.findSnapshot(userIdOf(99))).toBeUndefined();
  });
});

describe('save', () => {
  test('1つの一括の書き込みでプロフィール・ニックネームとハンドル・旧ハンドル・外部Webサイトを確定する', async () => {
    const store = createStore();

    const result = await store.save(
      saveInput(ALICE, {
        currentHandle: 'Alice',
        handle: 'alice-new',
        nickname: '新しい名前',
        avatarFileId: NEW_AVATAR,
        websites: [
          { name: 'GitHub', url: 'https://github.example/alice' },
          { name: null, url: 'https://blog.example/' },
        ],
      }),
    );

    expect(result).toBe('saved');
    const state = await readState();
    const alice = state.users.find((row) => row.id === userIdOf(ALICE));
    expect(alice).toMatchObject({
      nickname: '新しい名前',
      handle: 'alice-new',
      updatedAt: SAVED_AT,
    });
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]).toMatchObject({
      userId: userIdOf(ALICE),
      headline: '新しいヘッドライン',
      bioMarkdown: '**自己紹介**',
      avatarFileId: NEW_AVATAR,
      createdAt: SAVED_AT,
      updatedAt: SAVED_AT,
    });
    expect(state.previous).toHaveLength(1);
    expect(state.previous[0]).toMatchObject({
      ownerId: userIdOf(ALICE),
      handle: 'Alice',
      deletedAt: null,
    });
    expect(
      state.websites.map(({ position, name, url }) => ({
        position,
        name,
        url,
      })),
    ).toEqual([
      { position: 0, name: 'GitHub', url: 'https://github.example/alice' },
      { position: 1, name: null, url: 'https://blog.example/' },
    ]);
  });

  test('既存のプロフィールの行を更新し、作成日時とIDを保つ', async () => {
    await insertProfile(ALICE, {
      headline: '古い',
      bioMarkdown: '古い',
      avatarFileId: OLD_AVATAR,
    });
    const store = createStore();

    const result = await store.save(
      saveInput(ALICE, {
        currentHandle: 'Alice',
        currentAvatarFileId: OLD_AVATAR,
        avatarFileId: null,
        headline: null,
        bioMarkdown: null,
      }),
    );

    expect(result).toBe('saved');
    const { profiles } = await readState();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      id: '01JC0PROF00000000000000001',
      headline: null,
      bioMarkdown: null,
      avatarFileId: null,
      createdAt: T0,
      updatedAt: SAVED_AT,
    });
  });

  test('ハンドルを変えない保存では旧ハンドルを作らず、ハンドルをそのまま保つ', async () => {
    const result = await createStore().save(
      saveInput(ALICE, { currentHandle: 'Alice' }),
    );

    expect(result).toBe('saved');
    const state = await readState();
    expect(state.previous).toEqual([]);
    expect(state.users.find((row) => row.id === userIdOf(ALICE))?.handle).toBe(
      'Alice',
    );
  });

  test('大文字小文字だけの変更では表記を更新し旧ハンドルを作らない', async () => {
    const result = await createStore().save(
      saveInput(ALICE, { currentHandle: 'Alice', handle: 'ALICE' }),
    );

    expect(result).toBe('saved');
    const state = await readState();
    expect(state.previous).toEqual([]);
    expect(state.users.find((row) => row.id === userIdOf(ALICE))?.handle).toBe(
      'ALICE',
    );
  });

  test('ハンドルを続けて変えると旧ハンドルは1行のまま直前の値に置き換わる', async () => {
    const store = createStore();
    await store.save(
      saveInput(ALICE, { currentHandle: 'Alice', handle: 'alice-2' }),
    );
    await db.update(userPreviousHandles).set({ deletedAt: after(5) });

    const result = await store.save(
      saveInput(ALICE, { currentHandle: 'alice-2', handle: 'alice-3' }),
    );

    expect(result).toBe('saved');
    const { previous } = await readState();
    expect(previous).toHaveLength(1);
    expect(previous[0]).toMatchObject({ handle: 'alice-2', deletedAt: null });
  });

  test('自分の旧ハンドルへ戻せて、変更前のハンドルが旧ハンドルになる', async () => {
    await insertPreviousHandle(1, ALICE, 'alice-old');
    await db
      .update(users)
      .set({ handle: 'alice-now' })
      .where(eq(users.id, userIdOf(ALICE)));

    const result = await createStore().save(
      saveInput(ALICE, { currentHandle: 'alice-now', handle: 'alice-old' }),
    );

    expect(result).toBe('saved');
    const { previous } = await readState();
    expect(previous).toHaveLength(1);
    expect(previous[0]).toMatchObject({
      ownerId: userIdOf(ALICE),
      handle: 'alice-now',
    });
  });

  test('他人の旧ハンドルと同じ文字列を保存すると、その旧ハンドルの行が消え以後は保存した利用者に解決される', async () => {
    await insertPreviousHandle(1, BOB, 'old-bob');
    expect(await resolveHandle(db, USER_HANDLE_NAMESPACE, 'OLD-BOB')).toEqual({
      kind: 'previous',
      ownerId: userIdOf(BOB),
    });

    const result = await createStore().save(
      saveInput(ALICE, { currentHandle: 'Alice', handle: 'Old-Bob' }),
    );

    expect(result).toBe('saved');
    const { previous } = await readState();
    expect(previous.map((row) => row.ownerId)).toEqual([userIdOf(ALICE)]);
    expect(await resolveHandle(db, USER_HANDLE_NAMESPACE, 'old-bob')).toEqual({
      kind: 'current',
      ownerId: userIdOf(ALICE),
      handle: 'Old-Bob',
    });
  });

  test('論理削除済みの他人の旧ハンドルと同じ文字列でも保存でき、その行は物理削除される', async () => {
    await insertPreviousHandle(1, BOB, 'old-bob', { deletedAt: after(1) });

    const result = await createStore().save(
      saveInput(ALICE, { currentHandle: 'Alice', handle: 'old-bob' }),
    );

    expect(result).toBe('saved');
    const { previous } = await readState();
    expect(previous.map((row) => row.ownerId)).toEqual([userIdOf(ALICE)]);
  });

  test('外部Webサイトは全件を置き換え、空の一覧で全て消す', async () => {
    await insertWebsite(ALICE, 0, 'A', 'https://a.example/');
    await insertWebsite(ALICE, 1, 'B', 'https://b.example/');
    await insertWebsite(ALICE, 2, 'C', 'https://c.example/');
    await insertWebsite(BOB, 0, 'Bob', 'https://bob.example/');
    const store = createStore();

    await store.save(
      saveInput(ALICE, {
        currentHandle: 'Alice',
        websites: [{ name: null, url: 'https://only.example/' }],
      }),
    );

    expect(
      (await readState()).websites.map(({ userId, position, url }) => ({
        userId,
        position,
        url,
      })),
    ).toEqual([
      { userId: userIdOf(ALICE), position: 0, url: 'https://only.example/' },
      { userId: userIdOf(BOB), position: 0, url: 'https://bob.example/' },
    ]);

    await store.save(
      saveInput(ALICE, { currentHandle: 'Alice', websites: [] }),
    );

    expect((await readState()).websites.map(({ userId }) => userId)).toEqual([
      userIdOf(BOB),
    ]);
  });

  test('外部Webサイトの上限の10件を保存できる', async () => {
    const websites = Array.from({ length: 10 }, (_, index) => ({
      name: `名前${String(index)}`,
      url: `https://site${String(index)}.example/`,
    }));

    const result = await createStore().save(
      saveInput(ALICE, { currentHandle: 'Alice', websites }),
    );

    expect(result).toBe('saved');
    expect(
      (await readState()).websites.map(({ position }) => position),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('他人の現在のハンドルは大文字小文字を問わず使用中で、どの行も変わらない', async () => {
    await insertWebsite(ALICE, 0, 'A', 'https://a.example/');
    const before = await readState();

    const result = await createStore().save(
      saveInput(ALICE, {
        currentHandle: 'Alice',
        handle: 'BOB',
        websites: [{ name: null, url: 'https://new.example/' }],
      }),
    );

    expect(result).toBe('handle-unavailable');
    expect(await readState()).toEqual(before);
  });

  test('退会済みで物理削除前の利用者のハンドルも使用中である', async () => {
    await db
      .update(users)
      .set({ deletedAt: after(1) })
      .where(eq(users.id, userIdOf(CAROL)));

    const result = await createStore().save(
      saveInput(ALICE, { currentHandle: 'Alice', handle: 'carol' }),
    );

    expect(result).toBe('handle-unavailable');
  });

  test('停止中の利用者の保存は取り消され、どの行も変わらない', async () => {
    await db
      .update(users)
      .set({ status: 'suspended', suspendedAt: after(1) })
      .where(eq(users.id, userIdOf(ALICE)));
    const before = await readState();

    const result = await createStore().save(
      saveInput(ALICE, {
        currentHandle: 'Alice',
        handle: 'alice-new',
        websites: [{ name: null, url: 'https://new.example/' }],
      }),
    );

    expect(result).toBe('account-unavailable');
    expect(await readState()).toEqual(before);
  });

  test('退会済みの利用者と存在しない利用者の保存は取り消される', async () => {
    await db
      .update(users)
      .set({ deletedAt: after(1) })
      .where(eq(users.id, userIdOf(ALICE)));
    const before = await readState();
    const store = createStore();

    expect(await store.save(saveInput(ALICE, { currentHandle: 'Alice' }))).toBe(
      'account-unavailable',
    );
    expect(await store.save(saveInput(99, { currentHandle: 'ghost' }))).toBe(
      'account-unavailable',
    );
    expect(await readState()).toEqual(before);
  });

  test('停止中でハンドルも食い違う保存は利用者が使えない理由として分類する', async () => {
    await db
      .update(users)
      .set({ status: 'suspended', suspendedAt: after(1), handle: 'moved' })
      .where(eq(users.id, userIdOf(ALICE)));

    const result = await createStore().save(
      saveInput(ALICE, { currentHandle: 'Alice', handle: 'alice-new' }),
    );

    expect(result).toBe('account-unavailable');
  });

  test('読み込んだ時点のハンドルから変わっていれば競合になり、どの行も変わらない', async () => {
    await db
      .update(users)
      .set({ handle: 'alice-elsewhere' })
      .where(eq(users.id, userIdOf(ALICE)));
    const before = await readState();

    const result = await createStore().save(
      saveInput(ALICE, { currentHandle: 'Alice', handle: 'alice-new' }),
    );

    expect(result).toBe('conflict');
    expect(await readState()).toEqual(before);
  });

  test('大文字小文字だけの違いも競合として検出する', async () => {
    const before = await readState();

    const result = await createStore().save(
      saveInput(ALICE, { currentHandle: 'alice', handle: 'alice-new' }),
    );

    expect(result).toBe('conflict');
    expect(await readState()).toEqual(before);
  });

  test('同じハンドルを同時に保存する2人のうち一方だけが成功する', async () => {
    const store = createStore();

    const results = await Promise.all([
      store.save(
        saveInput(ALICE, { currentHandle: 'Alice', handle: 'popular' }),
      ),
      store.save(saveInput(BOB, { currentHandle: 'bob', handle: 'POPULAR' })),
    ]);

    expect(results.toSorted()).toEqual(['handle-unavailable', 'saved']);
    const { users: rows, previous } = await readState();
    expect(
      rows.filter((row) => row.handle.toLowerCase() === 'popular'),
    ).toHaveLength(1);
    expect(previous).toHaveLength(1);
  });

  test('同じ利用者の同時の2つの保存は一方が競合になる', async () => {
    const store = createStore();

    const results = await Promise.all([
      store.save(saveInput(ALICE, { currentHandle: 'Alice', handle: 'first' })),
      store.save(
        saveInput(ALICE, { currentHandle: 'Alice', handle: 'second' }),
      ),
    ]);

    expect(results.toSorted()).toEqual(['conflict', 'saved']);
    expect((await readState()).previous).toHaveLength(1);
  });

  test('制約の違反ではない障害は分類せずそのまま投げる', async () => {
    const store = new D1ProfileStore(createFailingDatabase());

    await expect(
      store.save(saveInput(ALICE, { currentHandle: 'Alice' })),
    ).rejects.toThrow();
  });
});

describe('isHandleOccupied', () => {
  test('既定では他人の現在のハンドルだけを大文字小文字を問わず数える', async () => {
    await insertPreviousHandle(1, BOB, 'old-bob');
    const store = createStore();

    expect(await store.isHandleOccupied('BOB')).toBe(true);
    expect(await store.isHandleOccupied('old-bob')).toBe(false);
    expect(await store.isHandleOccupied('nobody')).toBe(false);
  });

  test('includePreviousのときは他人の旧ハンドルも論理削除済みを含めて数える', async () => {
    await insertPreviousHandle(1, BOB, 'old-bob');
    await insertPreviousHandle(2, CAROL, 'old-carol', { deletedAt: after(1) });
    const store = createStore();

    expect(
      await store.isHandleOccupied('OLD-BOB', { includePrevious: true }),
    ).toBe(true);
    expect(
      await store.isHandleOccupied('old-carol', { includePrevious: true }),
    ).toBe(true);
  });

  test('exceptUserIdで本人の現在のハンドルと旧ハンドルを除く', async () => {
    await insertPreviousHandle(1, ALICE, 'alice-old');
    const store = createStore();
    const options = { exceptUserId: userIdOf(ALICE), includePrevious: true };

    expect(await store.isHandleOccupied('alice', options)).toBe(false);
    expect(await store.isHandleOccupied('alice-old', options)).toBe(false);
    expect(await store.isHandleOccupied('bob', options)).toBe(true);
    expect(await store.isHandleOccupied('alice-old')).toBe(false);
    expect(
      await store.isHandleOccupied('alice-old', { includePrevious: true }),
    ).toBe(true);
  });
});

describe('findExistingUserIds', () => {
  test('usersに行がある利用者のIDだけを返し、退会済みで物理削除前も含む', async () => {
    await db
      .update(users)
      .set({ deletedAt: after(1) })
      .where(eq(users.id, userIdOf(CAROL)));

    const found = await createStore().findExistingUserIds([
      userIdOf(ALICE),
      userIdOf(CAROL),
      userIdOf(99),
    ]);

    expect([...found].toSorted()).toEqual([userIdOf(ALICE), userIdOf(CAROL)]);
  });

  test('空の入力は問い合わせずに空の集合を返す', async () => {
    const recording = createRecordingDatabase();

    const found = await new D1ProfileStore(
      recording.database,
    ).findExistingUserIds([]);

    expect(found.size).toBe(0);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超えるIDはバインド変数の上限に収まるよう分割して照会する', async () => {
    const indexes = Array.from({ length: 200 }, (_, index) => index + 10);
    await insertUsers(indexes.filter((index) => index % 2 === 0));
    const recording = createRecordingDatabase();

    const found = await new D1ProfileStore(
      recording.database,
    ).findExistingUserIds(indexes.map((index) => userIdOf(index)));

    expect(found.size).toBe(100);
    expect(found.has(userIdOf(10))).toBe(true);
    expect(found.has(userIdOf(11))).toBe(false);
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});
