import { beforeEach, describe, expect, test } from 'vitest';

import { AppError } from '../../core/errors/app-error.ts';
import type {
  AdminUserDirectory,
  AdminUserRecord,
  AdminUserSearchFilter,
} from '../../core/identity/ports.ts';
import { D1AdminUserDirectory } from './d1-admin-user-directory.ts';
import {
  after,
  clearIdentityTables,
  createFailingDatabase,
  createRecordingDatabase,
  db,
  expectSplitWithinBindLimit,
  expectWithinBindLimit,
  insertUser,
  insertUsers,
  T0,
  userIdOf,
} from './testing/identity-store-fixtures.ts';

const RECORD_FIELDS = [
  'userId',
  'pseudonymousId',
  'handle',
  'nickname',
  'status',
  'suspendedAt',
  'registeredAt',
  'emailVerified',
  'disposableEmailStatus',
] as const satisfies readonly (keyof AdminUserRecord)[];

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();

function base64urlOf(text: string): string {
  return textEncoder.encode(text).toBase64(BASE64URL_OPTIONS);
}

function createDirectory(database = db): AdminUserDirectory {
  return new D1AdminUserDirectory(database);
}

async function searchIds(
  filter: AdminUserSearchFilter,
  limit = 50,
): Promise<readonly string[]> {
  const { users } = await createDirectory().search(filter, { limit });
  return users.map((user) => user.userId);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

beforeEach(async () => {
  await clearIdentityTables();
});

describe('D1AdminUserDirectory', () => {
  describe('search', () => {
    test('退会済みを除いて作成日時とIDの降順に並べる', async () => {
      await insertUser(1, { createdAt: after(1000) });
      await insertUser(2, { createdAt: after(3000) });
      await insertUser(3, { createdAt: after(2000) });
      await insertUser(4, { createdAt: after(2000) });
      await insertUser(5, { createdAt: after(4000), deletedAt: after(5000) });

      await expect(searchIds({})).resolves.toEqual([
        userIdOf(2),
        userIdOf(4),
        userIdOf(3),
        userIdOf(1),
      ]);
    });

    test('利用者の管理画面向けの項目を返す', async () => {
      await insertUser(1, {
        pseudonymousId: 'pseudonymous-taro',
        handle: 'TaroYamada',
        nickname: '山田太郎',
        status: 'suspended',
        suspendedAt: after(3000),
        emailVerifiedAt: after(1000),
        disposableEmailStatus: 'regular',
        disposableEmailCheckedAt: after(1000),
        createdAt: after(500),
      });
      await insertUser(2, { createdAt: after(100) });

      const { users } = await createDirectory().search({}, { limit: 50 });

      expect(users).toEqual([
        {
          userId: userIdOf(1),
          pseudonymousId: 'pseudonymous-taro',
          handle: 'TaroYamada',
          nickname: '山田太郎',
          status: 'suspended',
          suspendedAt: after(3000),
          registeredAt: after(500),
          emailVerified: true,
          disposableEmailStatus: 'regular',
        },
        {
          userId: userIdOf(2),
          pseudonymousId: 'pseudonymous-2',
          handle: 'user2',
          nickname: '利用者2',
          status: 'active',
          suspendedAt: null,
          registeredAt: after(100),
          emailVerified: false,
          disposableEmailStatus: null,
        },
      ]);
    });

    test('結果にメールアドレス・パスワードハッシュの項目を含めない', async () => {
      await insertUser(1, {
        email: 'secret.address@mail.example',
        passwordHash: 'pbkdf2-sha256$secret-hash',
      });

      const { users } = await createDirectory().search(
        { email: 'secret.address@mail.example' },
        { limit: 50 },
      );
      const [user] = users;

      expect(Object.keys(user ?? {}).toSorted()).toEqual(
        [...RECORD_FIELDS].toSorted(),
      );
      expect(Object.values(user ?? {})).not.toContain(
        'secret.address@mail.example',
      );
      expect(Object.values(user ?? {})).not.toContain(
        'pbkdf2-sha256$secret-hash',
      );
    });

    test('ハンドルを大文字小文字を区別しない部分一致で絞り込む', async () => {
      await insertUser(1, { handle: 'TaroYamada' });
      await insertUser(2, { handle: 'hanako' });
      await insertUser(3, { handle: 'YAMAOKA' });

      await expect(searchIds({ handle: 'yAmA' })).resolves.toEqual([
        userIdOf(3),
        userIdOf(1),
      ]);
    });

    test('ニックネームを大文字小文字を区別しない部分一致で絞り込む', async () => {
      await insertUser(1, { nickname: 'Hanako Sato' });
      await insertUser(2, { nickname: '佐藤花子' });
      await insertUser(3, { nickname: 'HANAMI' });

      await expect(searchIds({ nickname: 'hana' })).resolves.toEqual([
        userIdOf(3),
        userIdOf(1),
      ]);
      await expect(searchIds({ nickname: '藤花' })).resolves.toEqual([
        userIdOf(2),
      ]);
    });

    test.each([
      ['%', '100%達成', '1000達成'],
      ['_', 'a_b', 'axb'],
      ['\\', 'a\\b', 'ab'],
    ])(
      '部分一致の入力の%sをワイルドカードではなく文字として照合する',
      async (_character, matching, nonMatching) => {
        await insertUser(1, { nickname: matching, handle: matching });
        await insertUser(2, { nickname: nonMatching, handle: nonMatching });

        await expect(searchIds({ nickname: matching })).resolves.toEqual([
          userIdOf(1),
        ]);
        await expect(searchIds({ handle: matching })).resolves.toEqual([
          userIdOf(1),
        ]);
      },
    );

    test('メールアドレスを前後の空白を除いた大文字小文字を区別しない完全一致で絞り込む', async () => {
      await insertUser(1, { email: 'Taro.Yamada@Mail.Example' });
      await insertUser(2, { email: 'taro.yamada@mail.example.example' });

      await expect(
        searchIds({ email: '  taro.yamada@mail.example \n' }),
      ).resolves.toEqual([userIdOf(1)]);
      await expect(searchIds({ email: 'taro.yamada@mail' })).resolves.toEqual(
        [],
      );
    });

    test('退会済みの利用者はメールアドレスが一致しても返さない', async () => {
      await insertUser(1, {
        email: 'same@mail.example',
        deletedAt: after(1000),
      });

      await expect(searchIds({ email: 'same@mail.example' })).resolves.toEqual(
        [],
      );
    });

    test('状態で絞り込む', async () => {
      await insertUser(1, { createdAt: after(1) });
      await insertUser(2, {
        createdAt: after(2),
        status: 'suspended',
        suspendedAt: after(10),
      });
      await insertUser(3, { createdAt: after(3) });

      await expect(searchIds({ status: 'active' })).resolves.toEqual([
        userIdOf(3),
        userIdOf(1),
      ]);
      await expect(searchIds({ status: 'suspended' })).resolves.toEqual([
        userIdOf(2),
      ]);
    });

    test('複数の条件をすべて満たす利用者だけを返す', async () => {
      await insertUser(1, { handle: 'yamada1', nickname: '山田' });
      await insertUser(2, {
        handle: 'yamada2',
        nickname: '山田',
        status: 'suspended',
      });
      await insertUser(3, { handle: 'sato', nickname: '山田' });

      await expect(
        searchIds({ handle: 'yamada', nickname: '山田', status: 'active' }),
      ).resolves.toEqual([userIdOf(1)]);
    });

    test.each([1, 50])('件数の上限%iを受け付ける', async (limit) => {
      await insertUsers(range(1, 51));

      const { users, nextCursor } = await createDirectory().search(
        {},
        { limit },
      );

      expect(users).toHaveLength(limit);
      expect(nextCursor).not.toBeNull();
    });

    test.each([0, 51, -1, 1.5, Number.NaN])(
      '件数の上限%sを入力の誤りとして拒否する',
      async (limit) => {
        const searching = createDirectory().search({}, { limit });

        await expect(searching).rejects.toBeInstanceOf(AppError);
        await expect(searching).rejects.toMatchObject({
          kind: 'bad_request',
          code: 'validation_error',
        });
      },
    );

    test('カーソルで続きを取得し、最後のページではカーソルを返さない', async () => {
      await insertUser(1, { createdAt: after(1000) });
      await insertUser(2, { createdAt: after(2000) });
      await insertUser(3, { createdAt: after(2000) });
      await insertUser(4, { createdAt: after(2000) });
      await insertUser(5, { createdAt: after(3000) });
      const directory = createDirectory();

      const first = await directory.search({}, { limit: 2 });
      const second = await directory.search(
        {},
        { limit: 2, after: first.nextCursor ?? undefined },
      );
      const third = await directory.search(
        {},
        { limit: 2, after: second.nextCursor ?? undefined },
      );

      expect(first.users.map((user) => user.userId)).toEqual([
        userIdOf(5),
        userIdOf(4),
      ]);
      expect(second.users.map((user) => user.userId)).toEqual([
        userIdOf(3),
        userIdOf(2),
      ]);
      expect(third.users.map((user) => user.userId)).toEqual([userIdOf(1)]);
      expect(third.nextCursor).toBeNull();
    });

    test('続きが無い件数ちょうどのページではカーソルを返さない', async () => {
      await insertUsers([1, 2]);

      const { users, nextCursor } = await createDirectory().search(
        {},
        { limit: 2 },
      );

      expect(users).toHaveLength(2);
      expect(nextCursor).toBeNull();
    });

    test('カーソルは最後の利用者の作成日時のミリ秒とIDをコロンでつないだbase64urlである', async () => {
      await insertUser(1, { createdAt: after(1000) });
      await insertUser(2, { createdAt: after(2000) });

      const { nextCursor } = await createDirectory().search({}, { limit: 1 });

      expect(nextCursor).toBe(
        base64urlOf(`${String(after(2000).getTime())}:${userIdOf(2)}`),
      );
    });

    test('カーソルの続きにも絞り込みの条件を適用する', async () => {
      await insertUser(1, { createdAt: after(1000) });
      await insertUser(2, { createdAt: after(2000), status: 'suspended' });
      await insertUser(3, { createdAt: after(3000) });
      await insertUser(4, { createdAt: after(4000), status: 'suspended' });
      const directory = createDirectory();

      const first = await directory.search(
        { status: 'suspended' },
        { limit: 1 },
      );
      const second = await directory.search(
        { status: 'suspended' },
        { limit: 1, after: first.nextCursor ?? undefined },
      );

      expect(first.users.map((user) => user.userId)).toEqual([userIdOf(4)]);
      expect(second.users.map((user) => user.userId)).toEqual([userIdOf(2)]);
      expect(second.nextCursor).toBeNull();
    });

    test.each([
      ['形式の違う文字列', 'not-a-cursor'],
      ['空文字列', ''],
      ['区切りの無い値', base64urlOf(`1730419200000${userIdOf(1)}`)],
      ['ミリ秒が数字でない値', base64urlOf(`abc:${userIdOf(1)}`)],
      ['IDの欠けた値', base64urlOf('1730419200000:')],
      ['IDの長さが違う値', base64urlOf('1730419200000:01JC0USER')],
      ['パディング付きの値', `${base64urlOf(`1:${userIdOf(1)}`)}=`],
      ['base64urlでない文字を含む値', `${base64urlOf(`1:${userIdOf(1)}`)}+`],
    ])(
      '不正なカーソル(%s)をページの位置の指定の誤りとして拒否する',
      async (_name, after) => {
        const searching = createDirectory().search({}, { limit: 10, after });

        await expect(searching).rejects.toBeInstanceOf(AppError);
        await expect(searching).rejects.toMatchObject({
          kind: 'bad_request',
          code: 'invalid_cursor',
          message: 'ページの位置の指定が正しくありません。',
        });
      },
    );

    test('D1への問い合わせに失敗したら例外にする', async () => {
      await expect(
        createDirectory(createFailingDatabase()).search({}, { limit: 10 }),
      ).rejects.toThrow();
    });
  });

  describe('findByIds', () => {
    test('指定したIDの利用者をIDごとに返し、退会済み・存在しないIDを含めない', async () => {
      await insertUser(1, { handle: 'first' });
      await insertUser(2, { deletedAt: after(1000) });
      await insertUser(3, { status: 'suspended', suspendedAt: after(500) });

      const found = await createDirectory().findByIds([
        userIdOf(1),
        userIdOf(2),
        userIdOf(3),
        userIdOf(4),
        userIdOf(1),
      ]);

      expect([...found.keys()].toSorted()).toEqual([userIdOf(1), userIdOf(3)]);
      expect(found.get(userIdOf(1))).toMatchObject({
        userId: userIdOf(1),
        handle: 'first',
        status: 'active',
      });
      expect(found.get(userIdOf(3))).toMatchObject({
        status: 'suspended',
        suspendedAt: after(500),
      });
      expect(Object.keys(found.get(userIdOf(1)) ?? {}).toSorted()).toEqual(
        [...RECORD_FIELDS].toSorted(),
      );
    });

    test('空の一覧ではD1へ問い合わせずに空の結果を返す', async () => {
      const { database, placeholderCounts } = createRecordingDatabase();

      const found = await createDirectory(database).findByIds([]);

      expect(found.size).toBe(0);
      expect(placeholderCounts).toEqual([]);
    });

    test('90件までは1回の問い合わせで読む', async () => {
      await insertUsers(range(1, 90));
      const { database, placeholderCounts } = createRecordingDatabase();

      const found = await createDirectory(database).findByIds(
        range(1, 90).map(userIdOf),
      );

      expect(found.size).toBe(90);
      expect(placeholderCounts).toHaveLength(1);
      expectWithinBindLimit(placeholderCounts);
    });

    test('91件以上はバインド変数の上限に収まるよう分割して読み、退会済みを含めない', async () => {
      await insertUsers(range(1, 94));
      await insertUsers([95], { deletedAt: after(1000) });
      const { database, placeholderCounts } = createRecordingDatabase();

      const found = await createDirectory(database).findByIds(
        range(1, 96).map(userIdOf),
      );

      expect(found.size).toBe(94);
      expect(found.has(userIdOf(95))).toBe(false);
      expect(found.has(userIdOf(96))).toBe(false);
      expectSplitWithinBindLimit(placeholderCounts);
    });

    test('D1への問い合わせに失敗したら例外にする', async () => {
      await expect(
        createDirectory(createFailingDatabase()).findByIds([userIdOf(1)]),
      ).rejects.toThrow();
    });
  });

  describe('findByEmail', () => {
    test('前後の空白を除いた大文字小文字を区別しない完全一致で利用者を引く', async () => {
      await insertUser(1, { email: 'Taro.Yamada@Mail.Example' });
      await insertUser(2, { email: 'taro.yamada@mail.example.example' });

      const found = await createDirectory().findByEmail(
        ' taro.yamada@mail.example\t',
      );

      expect(found?.userId).toBe(userIdOf(1));
      expect(Object.keys(found ?? {}).toSorted()).toEqual(
        [...RECORD_FIELDS].toSorted(),
      );
    });

    test('退会済みの利用者は返さず、同じメールアドレスで再登録した利用者を返す', async () => {
      await insertUser(1, {
        email: 'same@mail.example',
        deletedAt: after(1000),
      });

      await expect(
        createDirectory().findByEmail('same@mail.example'),
      ).resolves.toBeUndefined();

      await insertUser(2, { email: 'same@mail.example' });

      await expect(
        createDirectory().findByEmail('same@mail.example'),
      ).resolves.toMatchObject({ userId: userIdOf(2) });
    });

    test('停止中の利用者も返す', async () => {
      await insertUser(1, { status: 'suspended', suspendedAt: after(1000) });

      await expect(
        createDirectory().findByEmail('user1@mail.example'),
      ).resolves.toMatchObject({ userId: userIdOf(1), status: 'suspended' });
    });

    test('一致する利用者がいなければundefinedを返す', async () => {
      await insertUser(1);

      await expect(
        createDirectory().findByEmail('user1@mail'),
      ).resolves.toBeUndefined();
    });

    test('D1への問い合わせに失敗したら例外にする', async () => {
      await expect(
        createDirectory(createFailingDatabase()).findByEmail(
          'user1@mail.example',
        ),
      ).rejects.toThrow();
    });
  });

  describe('countRegisteredAt', () => {
    test('時点より前に登録し、時点で退会していない利用者を数える', async () => {
      const at = after(10_000);
      await insertUser(1, { createdAt: after(1000) });
      await insertUser(2, { createdAt: after(9999) });
      await insertUser(3, { createdAt: at });
      await insertUser(4, { createdAt: after(10_001) });
      await insertUser(5, { createdAt: after(1000), deletedAt: after(9999) });
      await insertUser(6, { createdAt: after(1000), deletedAt: at });
      await insertUser(7, { createdAt: after(1000), deletedAt: after(20_000) });
      await insertUser(8, {
        createdAt: after(1000),
        status: 'suspended',
        suspendedAt: after(2000),
      });

      await expect(createDirectory().countRegisteredAt(at)).resolves.toBe(5);
    });

    test('利用者がいなければ0を返す', async () => {
      await expect(createDirectory().countRegisteredAt(T0)).resolves.toBe(0);
    });

    test('D1への問い合わせに失敗したら例外にする', async () => {
      await expect(
        createDirectory(createFailingDatabase()).countRegisteredAt(T0),
      ).rejects.toThrow();
    });
  });
});
