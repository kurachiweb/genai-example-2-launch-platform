import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  UserHandleResolution,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';
import { DefaultPublicProfileReader } from './public-profile-reader.ts';
import type { PublicProfileRecord } from './ports.ts';
import {
  createFakeAccountGuard,
  createFakePublicProfileStore,
  createFakeUltrasEntitlements,
  createFakeUserProfileDirectory,
  currentUserOf,
  fixedClock,
  OTHER_USER_ID,
  PROFILE_NOW,
  publicProfileRecordOf,
  SESSION,
  USER_ID,
} from './testing/profile-fakes.ts';

const TARGET_ID = '01JC0USER00000000000000009';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

const summaryOf = (
  overrides: Partial<UserSummaryRecord> = {},
): UserSummaryRecord => ({
  userId: TARGET_ID,
  handle: 'target',
  nickname: 'ターゲット',
  avatarFileId: null,
  suspended: false,
  ...overrides,
});

interface SetupOptions {
  readonly resolution?: UserHandleResolution;
  readonly viewerId?: string | undefined;
  readonly record?: PublicProfileRecord | undefined;
  readonly ultras?: boolean | Error;
}

function setup(options: SetupOptions = {}) {
  const calls: string[] = [];
  const viewerId = 'viewerId' in options ? options.viewerId : undefined;
  const guard = createFakeAccountGuard(
    calls,
    viewerId === undefined ? undefined : currentUserOf({ id: viewerId }),
  );
  const directory = createFakeUserProfileDirectory(
    calls,
    options.resolution ?? { kind: 'current', user: summaryOf() },
  );
  const store = createFakePublicProfileStore(
    calls,
    'record' in options ? options.record : publicProfileRecordOf(),
  );
  const ultras = createFakeUltrasEntitlements(calls, options.ultras ?? false);
  const reader = new DefaultPublicProfileReader(
    guard,
    directory,
    store,
    ultras.entitlements,
    fixedClock,
  );
  return { reader, calls, directory, store, ultras };
}

describe('PublicProfileReader.find: 形式と存在', () => {
  test.each([
    ['空文字列', ''],
    ['26文字', 'a'.repeat(26)],
    ['使えない文字を含む', 'ali ce'],
    ['日本語', 'アリス'],
    ['先頭がハイフン', '-alice'],
  ])(
    'ハンドルの形式に合わない値(%s)は照会せずnot-foundにする',
    async (_, handle) => {
      const { reader, calls } = setup();

      const result = await reader.find(SESSION, handle);

      expect(result).toEqual({ kind: 'not-found' });
      expect(calls).toEqual([]);
    },
  );

  test('25文字のハンドルは形式に合うため解決を試みる', async () => {
    const { reader, directory } = setup({ resolution: { kind: 'none' } });

    await reader.find(SESSION, 'a'.repeat(25));

    expect(directory.resolved).toEqual(['a'.repeat(25)]);
  });

  test('解決できないハンドル(存在しない・退会済み)はnot-foundにして、人物情報とUltrasを読まない', async () => {
    const { reader, calls } = setup({ resolution: { kind: 'none' } });

    const result = await reader.find(SESSION, 'ghost');

    expect(result).toEqual({ kind: 'not-found' });
    expect(calls).not.toContain('publicStore.load');
    expect(calls).not.toContain('ultras.isEntitledAt');
  });

  test('解決の後に退会して人物情報が読めなかったときもnot-foundにする', async () => {
    const { reader } = setup({ record: undefined });

    const result = await reader.find(SESSION, 'target');

    expect(result).toEqual({ kind: 'not-found' });
  });
});

describe('PublicProfileReader.find: 現在のハンドル', () => {
  test('未ログインの閲覧者にはguestとして人物情報を返し、ストアにも閲覧者なしを渡す', async () => {
    const record = publicProfileRecordOf({
      handle: 'Target',
      nickname: 'ターゲット',
      headline: '見出し',
      bioMarkdown: '本文',
      avatarFileId: '01JC0FILE00000000000000001',
      websites: [
        { name: 'GitHub', url: 'https://github.example/target' },
        { name: null, url: 'https://blog.example/' },
      ],
      followerCount: 12,
    });
    const { reader, store } = setup({ record, ultras: true });

    const result = await reader.find(SESSION, 'target');

    expect(result).toEqual({
      kind: 'profile',
      profile: {
        handle: 'Target',
        nickname: 'ターゲット',
        headline: '見出し',
        bioMarkdown: '本文',
        avatarFileId: '01JC0FILE00000000000000001',
        websites: [
          { name: 'GitHub', url: 'https://github.example/target' },
          { name: null, url: 'https://blog.example/' },
        ],
        followerCount: 12,
        ultras: true,
        suspended: false,
        viewerRelation: 'guest',
      },
    });
    expect(store.loads).toEqual([
      { userId: TARGET_ID, viewerUserId: undefined },
    ]);
  });

  test('ストアの閲覧者のフォローの有無を内部の項目として公開の型に出さない', async () => {
    const { reader } = setup({
      viewerId: OTHER_USER_ID,
      record: publicProfileRecordOf({ viewerFollows: true }),
    });

    const result = await reader.find(SESSION, 'target');

    expect(result.kind).toBe('profile');
    if (result.kind === 'profile') {
      expect('viewerFollows' in result.profile).toBe(false);
    }
  });

  test('フォロー中の閲覧者にはfollowing、フォローしていない閲覧者にはnot-followingを返し、閲覧者のIDをストアへ渡す', async () => {
    const following = setup({
      viewerId: OTHER_USER_ID,
      record: publicProfileRecordOf({ viewerFollows: true }),
    });
    const notFollowing = setup({
      viewerId: OTHER_USER_ID,
      record: publicProfileRecordOf({ viewerFollows: false }),
    });

    const a = await following.reader.find(SESSION, 'target');
    const b = await notFollowing.reader.find(SESSION, 'target');

    expect(a).toMatchObject({ profile: { viewerRelation: 'following' } });
    expect(b).toMatchObject({ profile: { viewerRelation: 'not-following' } });
    expect(following.store.loads).toEqual([
      { userId: TARGET_ID, viewerUserId: OTHER_USER_ID },
    ]);
  });

  test('本人が自分のプロフィールを見るとownerを返す', async () => {
    const { reader } = setup({
      viewerId: TARGET_ID,
      record: publicProfileRecordOf({ viewerFollows: false }),
    });

    const result = await reader.find(SESSION, 'target');

    expect(result).toMatchObject({ profile: { viewerRelation: 'owner' } });
  });

  test('ハンドルは大文字小文字を変えずに解決の口へ渡す', async () => {
    const { reader, directory } = setup();

    await reader.find(SESSION, 'TaRgEt');

    expect(directory.resolved).toEqual(['TaRgEt']);
  });
});

describe('PublicProfileReader.find: 停止中の利用者', () => {
  const suspended = (): UserHandleResolution => ({
    kind: 'current',
    user: summaryOf({ suspended: true }),
  });

  test('本人以外(未ログイン・他の利用者)にはnot-foundにし、人物情報を読まない', async () => {
    const guest = setup({ resolution: suspended() });
    const other = setup({ resolution: suspended(), viewerId: OTHER_USER_ID });

    expect(await guest.reader.find(SESSION, 'target')).toEqual({
      kind: 'not-found',
    });
    expect(await other.reader.find(SESSION, 'target')).toEqual({
      kind: 'not-found',
    });
    expect(guest.calls).not.toContain('publicStore.load');
    expect(other.calls).not.toContain('publicStore.load');
  });

  test('本人には停止中の印を付けて表示する', async () => {
    const { reader } = setup({
      resolution: suspended(),
      viewerId: TARGET_ID,
      record: publicProfileRecordOf({ suspended: true }),
    });

    const result = await reader.find(SESSION, 'target');

    expect(result).toMatchObject({
      kind: 'profile',
      profile: { suspended: true, viewerRelation: 'owner' },
    });
  });
});

describe('PublicProfileReader.find: 旧ハンドル', () => {
  const previous = (suspended = false): UserHandleResolution => ({
    kind: 'previous',
    user: summaryOf({ handle: 'Target-New', suspended }),
  });

  test('保有者の現在のハンドルへの転送を返し、人物情報とUltrasを読まない', async () => {
    const { reader, calls } = setup({ resolution: previous() });

    const result = await reader.find(SESSION, 'target-old');

    expect(result).toEqual({ kind: 'redirect', handle: 'Target-New' });
    expect(calls).not.toContain('publicStore.load');
    expect(calls).not.toContain('ultras.isEntitledAt');
  });

  test('保有者が停止中のとき、本人以外にはnot-foundにして現在のハンドルを明かさない', async () => {
    const guest = setup({ resolution: previous(true) });
    const other = setup({
      resolution: previous(true),
      viewerId: OTHER_USER_ID,
    });

    expect(await guest.reader.find(SESSION, 'target-old')).toEqual({
      kind: 'not-found',
    });
    expect(await other.reader.find(SESSION, 'target-old')).toEqual({
      kind: 'not-found',
    });
  });

  test('保有者が停止中でも、本人が自分の旧ハンドルを開けば転送する', async () => {
    const { reader } = setup({
      resolution: previous(true),
      viewerId: TARGET_ID,
    });

    const result = await reader.find(SESSION, 'target-old');

    expect(result).toEqual({ kind: 'redirect', handle: 'Target-New' });
  });
});

describe('PublicProfileReader.find: Ultras', () => {
  test('判定サービスの結果を反映し、対象の利用者と現在時刻で判定する', async () => {
    const entitled = setup({ ultras: true });
    const notEntitled = setup({ ultras: false });

    const a = await entitled.reader.find(SESSION, 'target');
    const b = await notEntitled.reader.find(SESSION, 'target');

    expect(a).toMatchObject({ profile: { ultras: true } });
    expect(b).toMatchObject({ profile: { ultras: false } });
    expect(entitled.ultras.queries).toEqual([
      { userId: TARGET_ID, at: PROFILE_NOW },
    ]);
  });

  test('判定が失敗してもプロフィールの表示を止めず、falseにしてwarningを記録する', async () => {
    const { reader } = setup({
      ultras: new Error('D1の障害'),
      record: publicProfileRecordOf({ followerCount: 3 }),
    });

    const result = await reader.find(SESSION, 'target');

    expect(result).toMatchObject({
      kind: 'profile',
      profile: { ultras: false, followerCount: 3 },
    });
    const warnings = records.filter((record) => record.level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.category).toEqual(['api', 'application', 'profile']);
    expect(Object.keys(warnings[0]?.properties ?? {}).toSorted()).toEqual([
      'error',
      'userId',
    ]);
    expect(warnings[0]?.properties['userId']).toBe(TARGET_ID);
  });

  test('判定が成功したときはwarningを記録しない', async () => {
    const { reader } = setup({ ultras: true });

    await reader.find(SESSION, 'target');

    expect(records.filter((record) => record.level === 'warning')).toEqual([]);
  });

  test('人物情報の読み取りの失敗は縮退させず呼び出し元へ伝える', async () => {
    const calls: string[] = [];
    const store = createFakePublicProfileStore(calls, publicProfileRecordOf());
    const failing = {
      load: () => Promise.reject(new Error('D1の障害')),
    };
    const reader = new DefaultPublicProfileReader(
      createFakeAccountGuard(calls, undefined),
      createFakeUserProfileDirectory(calls, {
        kind: 'current',
        user: summaryOf(),
      }),
      failing,
      createFakeUltrasEntitlements(calls, true).entitlements,
      fixedClock,
    );

    const error = await reader.find(SESSION, 'target').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('D1の障害');
    expect(store.loads).toEqual([]);
  });
});

describe('PublicProfileReader.find: 閲覧者の判定', () => {
  test('ログイン中の本人でない利用者のIDはUSER_IDと混同しない', async () => {
    const { reader, store } = setup({ viewerId: USER_ID });

    await reader.find(SESSION, 'target');

    expect(store.loads[0]?.viewerUserId).toBe(USER_ID);
  });
});
