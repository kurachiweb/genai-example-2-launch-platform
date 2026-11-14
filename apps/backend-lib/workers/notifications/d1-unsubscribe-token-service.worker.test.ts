import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { notificationPreferences } from '../../../db/schema/notifications/notification-preferences.ts';
import { notificationUnsubscribeTokens } from '../../../db/schema/notifications/notification-unsubscribe-tokens.ts';
import {
  createKeyedHasher,
  type HashPurpose,
  type KeyedHasher,
} from '../../core/crypto/keyed-hasher.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import type { UnsubscribeTarget } from '../../core/notifications/ports.ts';
import {
  isWellFormedUnsubscribeToken,
  UNSUBSCRIBE_LOOKUP_PURPOSE,
  UNSUBSCRIBE_TOKEN_PURPOSE,
  unsubscribeTokenSource,
} from '../../core/notifications/unsubscribe-token.ts';
import {
  createRecordingDatabase,
  createSequentialIds,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1UnsubscribeTokenService } from './d1-unsubscribe-token-service.ts';
import {
  after,
  clearNotificationTables,
  db,
  insertRecipient,
  readUnsubscribeTokenRows,
  recipientIdOf,
  T0,
} from './testing/notification-store-fixtures.ts';

const PEPPER = '0123456789abcdef0123456789abcdef';
const CHANGED_PEPPER = 'fedcba9876543210fedcba9876543210';

// 形式は正しいが、どの種からも導出していないトークン
const UNKNOWN_TOKEN = `${'0123456789abcdef'.repeat(5)}01234Q`;

const BULK_RECIPIENT_COUNT = 30;
const BULK_TOPICS: readonly NotificationTopic[] = [
  'match_preview',
  'match_result',
  'followed_user_match',
  'followed_user_award',
];

const hasher = createKeyedHasher(PEPPER);
const ids = createSequentialIds();

function serviceWith(
  options: {
    readonly hasher?: KeyedHasher;
    readonly ids?: IdGenerator;
    readonly database?: typeof db;
  } = {},
): D1UnsubscribeTokenService {
  return new D1UnsubscribeTokenService(
    options.database ?? db,
    options.hasher ?? hasher,
    options.ids ?? ids,
  );
}

const service = serviceWith();

function target(index: number, topic: NotificationTopic): UnsubscribeTarget {
  return { userId: recipientIdOf(index), topic };
}

function keyOf(index: number, topic: NotificationTopic): string {
  return `${recipientIdOf(index)}:${topic}`;
}

async function tokenOf(
  index: number,
  topic: NotificationTopic,
  tokenService = service,
  at = T0,
): Promise<string> {
  const tokens = await tokenService.tokensFor([target(index, topic)], at);
  const token = tokens.get(keyOf(index, topic));
  if (token === undefined) {
    throw new Error('トークンが返されませんでした');
  }
  return token;
}

interface VerifyCall {
  readonly purpose: HashPurpose;
  readonly value: string;
  readonly expectedHash: string;
}

function recordingHasher(): {
  readonly hasher: KeyedHasher;
  readonly verifyCalls: readonly VerifyCall[];
} {
  const verifyCalls: VerifyCall[] = [];
  return {
    hasher: {
      hash: (purpose, value) => hasher.hash(purpose, value),
      verify: (purpose, value, expectedHash) => {
        verifyCalls.push({ purpose, value, expectedHash });
        return hasher.verify(purpose, value, expectedHash);
      },
    },
    verifyCalls,
  };
}

beforeEach(async () => {
  await clearNotificationTables();
  await insertRecipient(1, { emailVerifiedAt: T0 });
  await insertRecipient(2, { emailVerifiedAt: T0 });
});

describe('tokensFor', () => {
  test('同じ利用者と種別には何度求めても同じトークンを返し、利用者か種別が違えば異なるトークンを返す', async () => {
    const first = await service.tokensFor(
      [
        target(1, 'match_result'),
        target(1, 'match_preview'),
        target(2, 'match_result'),
        target(1, 'match_result'),
      ],
      T0,
    );
    const second = await serviceWith().tokensFor(
      [target(2, 'match_result'), target(1, 'match_result')],
      after(10),
    );

    expect([...first.keys()].toSorted()).toEqual(
      [
        keyOf(1, 'match_preview'),
        keyOf(1, 'match_result'),
        keyOf(2, 'match_result'),
      ].toSorted(),
    );
    expect(new Set(first.values()).size).toBe(3);
    expect(
      [...first.values()].every((token) => isWellFormedUnsubscribeToken(token)),
    ).toBe(true);
    expect(second.get(keyOf(1, 'match_result'))).toBe(
      first.get(keyOf(1, 'match_result')),
    );
    expect(second.get(keyOf(2, 'match_result'))).toBe(
      first.get(keyOf(2, 'match_result')),
    );
  });

  test('種は組ごとに1行だけ作り、2回目以降は書き込まない', async () => {
    await tokenOf(1, 'match_result');
    const created = await readUnsubscribeTokenRows();

    await tokenOf(1, 'match_result', service, after(10));

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      userId: recipientIdOf(1),
      topic: 'match_result',
      createdAt: T0,
      updatedAt: T0,
    });
    expect(await readUnsubscribeTokenRows()).toEqual(created);
  });

  test('トークンの平文をデータベースに残さず、種と照合用のハッシュだけを保存する', async () => {
    const tokens = await service.tokensFor(
      [target(1, 'match_result'), target(2, 'followed_user_award')],
      T0,
    );

    const rows = await readUnsubscribeTokenRows();
    const stored = JSON.stringify(rows);
    for (const token of tokens.values()) {
      expect(stored).not.toContain(token);
    }
    for (const row of rows) {
      const token = tokens.get(`${row.userId}:${row.topic}`) ?? '';
      expect(row.seed).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(row.tokenHash).toBe(
        await hasher.hash(UNSUBSCRIBE_LOOKUP_PURPOSE, token),
      );
      expect(token).toBe(
        await hasher.hash(
          UNSUBSCRIBE_TOKEN_PURPOSE,
          unsubscribeTokenSource({
            userId: row.userId,
            topic: row.topic,
            seed: row.seed,
          }),
        ),
      );
    }
  });

  test('導出と照合の用途は別の値で、照合用のハッシュはトークンと一致せず、照合の用途で導出した値はトークンとして照合できない', async () => {
    const token = await tokenOf(1, 'match_result');
    const [row] = await readUnsubscribeTokenRows();
    const lookupDerived = await hasher.hash(
      UNSUBSCRIBE_LOOKUP_PURPOSE,
      unsubscribeTokenSource({
        userId: recipientIdOf(1),
        topic: 'match_result',
        seed: row?.seed ?? '',
      }),
    );

    expect(UNSUBSCRIBE_TOKEN_PURPOSE).not.toBe(UNSUBSCRIBE_LOOKUP_PURPOSE);
    expect(row?.tokenHash).not.toBe(token);
    expect(lookupDerived).not.toBe(token);
    expect(await service.resolve(lookupDerived)).toBeUndefined();
    expect(await service.resolve(row?.tokenHash ?? '')).toBeUndefined();
  });

  test('同時に同じ組のトークンを求めても種は1つだけ作られ、どちらも同じトークンを返す', async () => {
    const [first, second] = await Promise.all([
      serviceWith().tokensFor([target(1, 'match_preview')], T0),
      serviceWith().tokensFor([target(1, 'match_preview')], T0),
    ]);

    expect(await readUnsubscribeTokenRows()).toHaveLength(1);
    expect(first.get(keyOf(1, 'match_preview'))).toBe(
      second.get(keyOf(1, 'match_preview')),
    );
  });

  test('受信設定の変更やアカウントの停止の間もトークンを変えない', async () => {
    const before = await tokenOf(1, 'match_result');
    await db.insert(notificationPreferences).values({
      userId: recipientIdOf(1),
      topic: 'match_result',
      enabled: false,
      createdAt: after(5),
      updatedAt: after(5),
    });
    await db
      .update(users)
      .set({ status: 'suspended', suspendedAt: after(5) })
      .where(eq(users.id, recipientIdOf(1)));

    expect(await tokenOf(1, 'match_result', service, after(10))).toBe(before);
    expect(await service.resolve(before)).toEqual(target(1, 'match_result'));
  });

  test('多数の組をバインド変数の上限に収まる文に分けて作り、1件も落とさず返す', async () => {
    const indexes = Array.from(
      { length: BULK_RECIPIENT_COUNT },
      (_, offset) => offset + 100,
    );
    for (const index of indexes) {
      await insertRecipient(index);
    }
    const targets = indexes.flatMap((index) =>
      BULK_TOPICS.map((topic) => target(index, topic)),
    );
    const recording = createRecordingDatabase();

    const tokens = await serviceWith({
      database: recording.database,
    }).tokensFor(targets, T0);

    expect(tokens.size).toBe(targets.length);
    expect(await readUnsubscribeTokenRows()).toHaveLength(targets.length);
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });

  test('組が無ければデータベースへ問い合わせずに空を返す', async () => {
    const recording = createRecordingDatabase();

    const tokens = await serviceWith({
      database: recording.database,
    }).tokensFor([], T0);

    expect(tokens.size).toBe(0);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('ULIDでない利用者のIDはRangeErrorで拒否し、種を作らない', async () => {
    await expect(
      service.tokensFor(
        [
          target(1, 'match_result'),
          { userId: 'not-a-ulid', topic: 'match_result' },
        ],
        T0,
      ),
    ).rejects.toThrow(RangeError);
    expect(await readUnsubscribeTokenRows()).toEqual([]);
  });

  test('種の行を保存できなかった組があれば、一部だけのトークンを返さずに例外を投げる', async () => {
    const sameId: IdGenerator = {
      generate: () => '01JC0SAME00000000000000001',
    };

    await expect(
      serviceWith({ ids: sameId }).tokensFor(
        [target(1, 'match_result'), target(2, 'match_result')],
        T0,
      ),
    ).rejects.toThrow('配信停止のトークンの種を保存できませんでした');
  });
});

describe('ペッパーの変更', () => {
  test('ペッパーを変えた後に求めると照合用のハッシュを導出し直した値へ更新し、新しいトークンは照合でき変更の前のトークンは無効になる', async () => {
    const oldToken = await tokenOf(1, 'match_result');
    const [beforeChange] = await readUnsubscribeTokenRows();
    const changedHasher = createKeyedHasher(CHANGED_PEPPER);
    const changed = serviceWith({ hasher: changedHasher });

    expect(await changed.resolve(oldToken)).toBeUndefined();

    const newToken = await tokenOf(1, 'match_result', changed, after(10));
    const [afterChange] = await readUnsubscribeTokenRows();

    expect(newToken).not.toBe(oldToken);
    expect(afterChange).toEqual({
      ...beforeChange,
      tokenHash: await changedHasher.hash(UNSUBSCRIBE_LOOKUP_PURPOSE, newToken),
      updatedAt: after(10),
    });
    expect(await changed.resolve(newToken)).toEqual(target(1, 'match_result'));
    expect(await changed.resolve(oldToken)).toBeUndefined();
    expect(await tokenOf(1, 'match_result', changed, after(20))).toBe(newToken);
    expect((await readUnsubscribeTokenRows())[0]?.updatedAt).toEqual(after(10));
  });
});

describe('resolve', () => {
  test('照合用のハッシュで1行を引き、保存したハッシュとタイミングセーフな照合で確かめて組を返す', async () => {
    const token = await tokenOf(2, 'followed_user_match');
    const [row] = await readUnsubscribeTokenRows();
    const recording = recordingHasher();

    const resolved = await serviceWith({ hasher: recording.hasher }).resolve(
      token,
    );

    expect(resolved).toEqual(target(2, 'followed_user_match'));
    expect(recording.verifyCalls).toEqual([
      {
        purpose: UNSUBSCRIBE_LOOKUP_PURPOSE,
        value: token,
        expectedHash: row?.tokenHash,
      },
    ]);
  });

  test('形式違反のトークンはデータベースへ問い合わせずにundefinedを返す', async () => {
    const token = await tokenOf(1, 'match_result');
    const recording = createRecordingDatabase();
    const recordingService = serviceWith({ database: recording.database });

    for (const malformed of [
      '',
      'abc',
      `${token}A`,
      `${token.slice(0, -1)}B`,
    ]) {
      expect(await recordingService.resolve(malformed)).toBeUndefined();
    }
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('どの種からも導出していないトークンはundefinedを返す', async () => {
    await tokenOf(1, 'match_result');

    expect(isWellFormedUnsubscribeToken(UNKNOWN_TOKEN)).toBe(true);
    expect(await service.resolve(UNKNOWN_TOKEN)).toBeUndefined();
  });
});

describe('deleteAllOf', () => {
  test('退会した利用者の全ての種を削除してその利用者のトークンを無効にし、他の利用者のトークンは残す', async () => {
    const tokens = await service.tokensFor(
      [
        target(1, 'match_result'),
        target(1, 'followed_user_award'),
        target(2, 'match_result'),
      ],
      T0,
    );

    await service.deleteAllOf(recipientIdOf(1));

    expect(
      await service.resolve(tokens.get(keyOf(1, 'match_result')) ?? ''),
    ).toBeUndefined();
    expect(
      await service.resolve(tokens.get(keyOf(1, 'followed_user_award')) ?? ''),
    ).toBeUndefined();
    expect(
      await service.resolve(tokens.get(keyOf(2, 'match_result')) ?? ''),
    ).toEqual(target(2, 'match_result'));
    expect((await readUnsubscribeTokenRows()).map((row) => row.userId)).toEqual(
      [recipientIdOf(2)],
    );
  });

  test('種の行が直接削除された場合もトークンを無効にする', async () => {
    const token = await tokenOf(1, 'match_preview');

    await db
      .delete(notificationUnsubscribeTokens)
      .where(eq(notificationUnsubscribeTokens.userId, recipientIdOf(1)));

    expect(await service.resolve(token)).toBeUndefined();
  });
});
