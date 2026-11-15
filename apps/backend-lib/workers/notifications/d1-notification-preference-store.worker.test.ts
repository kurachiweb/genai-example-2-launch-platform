import { beforeEach, describe, expect, test } from 'vitest';

import { NOTIFICATION_TOPICS } from '../../../common-lib/notifications/notification-topics.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1NotificationPreferenceStore } from './d1-notification-preference-store.ts';
import {
  after,
  clearNotificationTables,
  db,
  insertPreference,
  insertPreferences,
  insertUser,
  insertUsers,
  readPreferencesOf,
  T0,
  userIdOf,
} from './testing/notification-store-fixtures.ts';

const BULK_USER_COUNT = 200;

const MISSING_USER_INDEX = 999;

const store = new D1NotificationPreferenceStore(db);

const BULK_INDEXES = Array.from(
  { length: BULK_USER_COUNT },
  (_, offset) => offset + 100,
);

beforeEach(async () => {
  await clearNotificationTables();
});

// 1: 送信の対象者、2: 停止中、3: 未確認、4: 退会済み、5: 送信の対象者(他の種別だけ受信)、6: 送信の対象者(受信しない設定の行)
async function insertRecipientCandidates(): Promise<void> {
  await insertUser(1, { emailVerifiedAt: T0 });
  await insertUser(2, {
    emailVerifiedAt: T0,
    status: 'suspended',
    suspendedAt: after(1),
  });
  await insertUser(3);
  await insertUser(4, { emailVerifiedAt: T0, deletedAt: after(2) });
  await insertUser(5, { emailVerifiedAt: T0 });
  await insertUser(6, { emailVerifiedAt: T0 });
  await insertPreferences([1, 2, 3, 4], 'match_result', true);
  await insertPreference(5, 'match_preview', true);
  await insertPreference(6, 'match_result', false);
}

describe('preferencesOf', () => {
  test('行が無い種別は受信しない設定として、4種別すべてを種別の順に返す', async () => {
    await insertUser(1);
    await insertUser(2);
    await insertPreference(1, 'match_result', true);
    await insertPreference(1, 'followed_user_award', false);
    await insertPreference(2, 'match_preview', true);

    const preferences = await store.preferencesOf(userIdOf(1));

    expect([...preferences]).toEqual([
      ['match_preview', false],
      ['match_result', true],
      ['followed_user_match', false],
      ['followed_user_award', false],
    ]);
  });

  test('行の無い利用者は4種別すべてを受信しない設定として返す', async () => {
    const preferences = await store.preferencesOf(userIdOf(MISSING_USER_INDEX));

    expect([...preferences.keys()]).toEqual([...NOTIFICATION_TOPICS]);
    expect([...preferences.values()].every((enabled) => !enabled)).toBe(true);
  });
});

describe('setPreference', () => {
  test('種別ごとに保存し、同じ種別の保存は作成日時を残して受信可否と更新日時だけを上書きする', async () => {
    await insertUser(1);

    await store.setPreference({
      userId: userIdOf(1),
      topic: 'match_result',
      enabled: true,
      at: after(10),
    });
    await store.setPreference({
      userId: userIdOf(1),
      topic: 'match_preview',
      enabled: true,
      at: after(20),
    });
    await store.setPreference({
      userId: userIdOf(1),
      topic: 'match_result',
      enabled: false,
      at: after(30),
    });

    expect(await readPreferencesOf(1)).toEqual([
      {
        topic: 'match_preview',
        enabled: true,
        createdAt: after(20),
        updatedAt: after(20),
      },
      {
        topic: 'match_result',
        enabled: false,
        createdAt: after(10),
        updatedAt: after(30),
      },
    ]);
    expect((await store.preferencesOf(userIdOf(1))).get('match_preview')).toBe(
      true,
    );
  });

  test('他の利用者の同じ種別の設定を変えない', async () => {
    await insertUsers([1, 2]);
    await insertPreferences([1, 2], 'match_result', true);

    await store.setPreference({
      userId: userIdOf(1),
      topic: 'match_result',
      enabled: false,
      at: after(10),
    });

    expect(await readPreferencesOf(2)).toEqual([
      {
        topic: 'match_result',
        enabled: true,
        createdAt: T0,
        updatedAt: T0,
      },
    ]);
  });
});

describe('eligibleRecipients', () => {
  test('指定した種別を受信する設定の利用者のうち、停止中・未確認・退会済みの利用者を除き、重複を1件にまとめる', async () => {
    await insertRecipientCandidates();

    const recipients = await store.eligibleRecipients(
      [1, 1, 2, 3, 4, 5, 6, MISSING_USER_INDEX].map(userIdOf),
      'match_result',
    );

    expect([...recipients]).toEqual([userIdOf(1)]);
  });

  test('空の一覧はデータベースへ問い合わせずに空の集合を返す', async () => {
    const recording = createRecordingDatabase();

    const recipients = await new D1NotificationPreferenceStore(
      recording.database,
    ).eligibleRecipients([], 'match_result');

    expect(recipients.size).toBe(0);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('91件以上の利用者をバインド変数の上限に収まる文に分けて1件も落とさず読む', async () => {
    await insertUsers(BULK_INDEXES, { emailVerifiedAt: T0 });
    await insertPreferences(BULK_INDEXES, 'followed_user_match', true);
    const recording = createRecordingDatabase();

    const recipients = await new D1NotificationPreferenceStore(
      recording.database,
    ).eligibleRecipients(BULK_INDEXES.map(userIdOf), 'followed_user_match');

    expect(recipients).toEqual(new Set(BULK_INDEXES.map(userIdOf)));
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('enabledTopicsOf', () => {
  test('送信の対象者だけをキーに持ち、受信する設定の種別を値にする。受信する種別の無い送信の対象者は空の集合になる', async () => {
    await insertRecipientCandidates();
    await insertPreference(1, 'followed_user_award', true);
    await insertPreference(1, 'match_preview', false);

    const topics = await store.enabledTopicsOf(
      [1, 2, 3, 4, 5, 6, 6, MISSING_USER_INDEX].map(userIdOf),
    );

    expect(
      new Map([...topics].toSorted(([a], [b]) => a.localeCompare(b))),
    ).toEqual(
      new Map([
        [userIdOf(1), new Set(['match_result', 'followed_user_award'])],
        [userIdOf(5), new Set(['match_preview'])],
        [userIdOf(6), new Set()],
      ]),
    );
  });

  test('空の一覧はデータベースへ問い合わせずに空の対応を返す', async () => {
    const recording = createRecordingDatabase();

    const topics = await new D1NotificationPreferenceStore(
      recording.database,
    ).enabledTopicsOf([]);

    expect(topics.size).toBe(0);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('91件以上の利用者をバインド変数の上限に収まる文に分けて1件も落とさず読む', async () => {
    await insertUsers(BULK_INDEXES, { emailVerifiedAt: T0 });
    await insertPreferences(BULK_INDEXES, 'match_preview', true);
    const recording = createRecordingDatabase();

    const topics = await new D1NotificationPreferenceStore(
      recording.database,
    ).enabledTopicsOf(BULK_INDEXES.map(userIdOf));

    expect(topics.size).toBe(BULK_USER_COUNT);
    expect(
      [...topics.values()].every(
        (enabled) => enabled.size === 1 && enabled.has('match_preview'),
      ),
    ).toBe(true);
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('deleteAllOf', () => {
  test('指定した利用者の受信設定だけをすべて削除する', async () => {
    await insertUsers([1, 2]);
    await insertPreference(1, 'match_preview', true);
    await insertPreference(1, 'match_result', false);
    await insertPreference(2, 'match_preview', true);

    await store.deleteAllOf(userIdOf(1));

    expect(await readPreferencesOf(1)).toEqual([]);
    expect(await readPreferencesOf(2)).toHaveLength(1);
  });
});
