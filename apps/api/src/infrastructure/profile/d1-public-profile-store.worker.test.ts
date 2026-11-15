import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { userFollows } from '../../../db/schema/follow/user-follows.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { userProfileWebsites } from '../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../db/schema/profile/user-profiles.ts';
import {
  after,
  clearIdentityTables,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type { PublicProfileStore } from '../../application/profile/ports.ts';
import { D1PublicProfileStore } from './d1-public-profile-store.ts';

const TARGET = 1;
const ALICE = 2;
const BOB = 3;
const CAROL = 4;

const AVATAR = '01JC0FILE00000000000000001';

interface D1Calls {
  readonly batchSizes: number[];
  readonly standalone: number;
}

// 読み取りが1回のbatchに収まることを確かめるため、batchの呼び出しと単独の実行を数える
function createCountingDatabase() {
  const d1 = env.DB;
  const batchSizes: number[] = [];
  let standalone = 0;
  const countStandalone = <T extends object>(statement: T): T =>
    new Proxy(statement, {
      get(target, property, receiver) {
        if (
          property === 'all' ||
          property === 'run' ||
          property === 'raw' ||
          property === 'first'
        ) {
          standalone += 1;
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
  const counting: D1Database = {
    prepare: (query) => countStandalone(d1.prepare(query)),
    batch: (statements) => {
      batchSizes.push(statements.length);
      return d1.batch(statements);
    },
    exec: d1.exec.bind(d1),
    withSession: d1.withSession.bind(d1),
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    dump: d1.dump.bind(d1),
  };
  const calls = (): D1Calls => ({ batchSizes, standalone });
  return { database: createDatabase(counting), calls };
}

function createStore(): PublicProfileStore {
  return new D1PublicProfileStore(db);
}

async function insertProfile(
  userIndex: number,
  columns: {
    readonly headline?: string | null;
    readonly bioMarkdown?: string | null;
    readonly avatarFileId?: string | null;
  },
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

async function insertFollow(
  followerIndex: number,
  followeeIndex: number,
  columns: { readonly deletedAt?: Date } = {},
): Promise<void> {
  await db.insert(userFollows).values({
    id: `01JC0FLW${String(followerIndex * 100 + followeeIndex).padStart(18, '0')}`,
    followerId: userIdOf(followerIndex),
    followeeId: userIdOf(followeeIndex),
    createdAt: T0,
    updatedAt: T0,
    deletedAt: columns.deletedAt ?? null,
  });
}

async function setStatus(
  userIndex: number,
  status: 'active' | 'suspended',
): Promise<void> {
  await db
    .update(users)
    .set(
      status === 'suspended'
        ? { status, suspendedAt: after(1) }
        : { status, suspendedAt: null },
    )
    .where(eq(users.id, userIdOf(userIndex)));
}

beforeEach(async () => {
  await db.delete(userFollows);
  await db.delete(userProfileWebsites);
  await db.delete(userProfiles);
  await clearIdentityTables();
  await insertUser(TARGET, { handle: 'Target', nickname: 'ターゲット' });
  await insertUser(ALICE, { handle: 'alice', nickname: 'アリス' });
  await insertUser(BOB, { handle: 'bob', nickname: 'ボブ' });
  await insertUser(CAROL, { handle: 'carol', nickname: 'キャロル' });
});

describe('D1PublicProfileStore.load', () => {
  test('プロフィールの行が無い利用者は空の項目・0人・フォローなしで返す', async () => {
    const record = await createStore().load(userIdOf(TARGET), undefined);

    expect(record).toEqual({
      handle: 'Target',
      nickname: 'ターゲット',
      headline: null,
      bioMarkdown: null,
      avatarFileId: null,
      websites: [],
      followerCount: 0,
      suspended: false,
      viewerFollows: false,
    });
  });

  test('人物情報・位置の順の外部Webサイト・可視のフォロワー数・閲覧者のフォローの有無を1回の読み取りで返す', async () => {
    await insertProfile(TARGET, {
      headline: '個人開発者',
      bioMarkdown: '**自己紹介**',
      avatarFileId: AVATAR,
    });
    await insertWebsite(TARGET, 1, null, 'https://b.example/');
    await insertWebsite(TARGET, 0, 'GitHub', 'https://github.example/target');
    await insertFollow(ALICE, TARGET);
    await insertFollow(BOB, TARGET);
    const counting = createCountingDatabase();

    const record = await new D1PublicProfileStore(counting.database).load(
      userIdOf(TARGET),
      userIdOf(ALICE),
    );

    expect(record).toEqual({
      handle: 'Target',
      nickname: 'ターゲット',
      headline: '個人開発者',
      bioMarkdown: '**自己紹介**',
      avatarFileId: AVATAR,
      websites: [
        { name: 'GitHub', url: 'https://github.example/target' },
        { name: null, url: 'https://b.example/' },
      ],
      followerCount: 2,
      suspended: false,
      viewerFollows: true,
    });
    const { batchSizes, standalone } = counting.calls();
    expect(batchSizes).toHaveLength(1);
    expect(standalone).toBe(0);
  });

  test('閲覧者がフォローしていなければfalse、閲覧者なしでもfalseを返す', async () => {
    await insertFollow(ALICE, TARGET);

    const store = createStore();
    const asBob = await store.load(userIdOf(TARGET), userIdOf(BOB));
    const asGuest = await store.load(userIdOf(TARGET), undefined);

    expect(asBob?.viewerFollows).toBe(false);
    expect(asGuest?.viewerFollows).toBe(false);
    expect(asBob?.followerCount).toBe(1);
  });

  test('解除(論理削除)されたフォローは数にも閲覧者のフォローにも含めない', async () => {
    await insertFollow(ALICE, TARGET, { deletedAt: after(1) });
    await insertFollow(BOB, TARGET);

    const record = await createStore().load(userIdOf(TARGET), userIdOf(ALICE));

    expect(record?.followerCount).toBe(1);
    expect(record?.viewerFollows).toBe(false);
  });

  test('停止中のフォロワーは数から除き、停止の解除で数に戻る', async () => {
    await insertFollow(ALICE, TARGET);
    await insertFollow(BOB, TARGET);
    await insertFollow(CAROL, TARGET);
    await setStatus(BOB, 'suspended');
    const store = createStore();

    const suspended = await store.load(userIdOf(TARGET), undefined);
    await setStatus(BOB, 'active');
    const restored = await store.load(userIdOf(TARGET), undefined);

    expect(suspended?.followerCount).toBe(2);
    expect(restored?.followerCount).toBe(3);
  });

  test('退会済みのフォロワーは数に含めない', async () => {
    await insertFollow(ALICE, TARGET);
    await insertFollow(BOB, TARGET);
    await db
      .update(users)
      .set({ deletedAt: after(1) })
      .where(eq(users.id, userIdOf(BOB)));

    const record = await createStore().load(userIdOf(TARGET), undefined);

    expect(record?.followerCount).toBe(1);
  });

  test('相手がフォローしている数(フォロー中)はフォロワー数に含めない', async () => {
    await insertFollow(TARGET, ALICE);
    await insertFollow(TARGET, BOB);

    const record = await createStore().load(userIdOf(TARGET), undefined);

    expect(record?.followerCount).toBe(0);
  });

  test('他の利用者の外部Webサイトとフォローを混ぜない', async () => {
    await insertWebsite(ALICE, 0, 'Alice', 'https://alice.example/');
    await insertFollow(BOB, ALICE);

    const record = await createStore().load(userIdOf(TARGET), userIdOf(BOB));

    expect(record?.websites).toEqual([]);
    expect(record?.followerCount).toBe(0);
    expect(record?.viewerFollows).toBe(false);
  });

  test('停止中の対象は停止中として返す(公開してよいかの判断は呼び出し側)', async () => {
    await setStatus(TARGET, 'suspended');

    const record = await createStore().load(userIdOf(TARGET), undefined);

    expect(record?.suspended).toBe(true);
  });

  test('退会済みの対象と存在しない対象はundefinedを返す', async () => {
    await db
      .update(users)
      .set({ deletedAt: after(1) })
      .where(eq(users.id, userIdOf(ALICE)));
    const store = createStore();

    expect(await store.load(userIdOf(ALICE), undefined)).toBeUndefined();
    expect(await store.load(userIdOf(99), undefined)).toBeUndefined();
  });
});
