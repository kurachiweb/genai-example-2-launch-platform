import { env } from 'cloudflare:workers';
import { eq, ne } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { users } from './schema/identity/users.ts';
import { notificationEvents } from './schema/notifications/notification-events.ts';
import { notificationNotices } from './schema/notifications/notification-notices.ts';
import { notificationPreferences } from './schema/notifications/notification-preferences.ts';
import { notificationSenderSettings } from './schema/notifications/notification-sender-settings.ts';
import { notificationSlotReadyMarks } from './schema/notifications/notification-slot-ready-marks.ts';
import { notificationSlots } from './schema/notifications/notification-slots.ts';
import { notificationUnsubscribeTokens } from './schema/notifications/notification-unsubscribe-tokens.ts';

interface TestMigration {
  readonly name: string;
  readonly queries: readonly string[];
}

const SEED_MIGRATION_SUFFIX = '_notifications_seed/migration.sql';

const SENDER_INFO_SETTING_ID = '01M7BNN5000000000000000001';

const SEEDED_AT = new Date(1794614400000);

const USER_ID = '01JN0000000000000000000U01';

const MISSING_USER_ID = '01JN0000000000000000000U99';

const AT = new Date(Date.UTC(2026, 10, 14, 14, 45));

const db = createDatabase(env.DB);

// Drizzleは単独のクエリの失敗をDrizzleQueryErrorで包んでD1のエラーをcauseに持つため、原因をたどって文言を集める
async function rejectionMessagesOf(
  pending: Promise<unknown>,
): Promise<string[]> {
  const reason: unknown = await pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  const messages: string[] = [];
  for (
    let current = reason;
    current instanceof Error;
    current = current.cause
  ) {
    messages.push(current.message);
  }
  return messages;
}

// TEST_MIGRATIONSはWorkers統合テストの設定だけが渡すバインディングで、実行時の環境の型には含めない
function seedMigration(): TestMigration {
  const migrations = (
    env as unknown as { readonly TEST_MIGRATIONS: readonly TestMigration[] }
  ).TEST_MIGRATIONS;
  const found = migrations.find((migration) =>
    migration.name.endsWith(SEED_MIGRATION_SUFFIX),
  );
  if (found === undefined) {
    throw new Error('送信者情報の初期データのマイグレーションがありません');
  }
  return found;
}

async function runSeed(): Promise<void> {
  for (const query of seedMigration().queries) {
    await env.DB.prepare(query).run();
  }
}

function noticeOf(dedupeKey: string, recipientUserId = USER_ID) {
  return {
    dedupeKey,
    slotKey: 'evening:2026-11-14',
    groupKey: `evening:2026-11-14:${recipientUserId}:01JN0000000000000000000P01`,
    topic: 'match_result' as const,
    recipientUserId,
    matchId: '01JN0000000000000000000M99',
    entryId: '01JN0000000000000000000N99',
    productId: '01JN0000000000000000000P99',
    eventId: '01JN0000000000000000000E99',
  };
}

function eventOf(dedupeKey: string) {
  return {
    type: 'match_result' as const,
    dedupeKey,
    publisher: 'match-engine',
    matchId: '01JN0000000000000000000M99',
    occurredAt: AT,
    lastDispatchedAt: AT,
  };
}

function slotOf(slotKey: string) {
  return {
    slotKey,
    kind: 'evening' as const,
    dueAt: AT,
    settleUntil: AT,
  };
}

function senderSettingOf(
  settingKey: string,
  version: number,
  values: {
    readonly businessName: string | null;
    readonly contactEmail: string | null;
    readonly postalAddress: string | null;
  },
) {
  return { settingKey, version, ...values };
}

const FILLED = {
  businessName: '運営者',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都',
} as const;

const EMPTY = {
  businessName: null,
  contactEmail: null,
  postalAddress: null,
} as const;

beforeEach(async () => {
  await db.delete(notificationNotices);
  await db.delete(notificationSlotReadyMarks);
  await db.delete(notificationSlots);
  await db.delete(notificationEvents);
  await db.delete(notificationUnsubscribeTokens);
  await db.delete(notificationPreferences);
  await db
    .delete(notificationSenderSettings)
    .where(ne(notificationSenderSettings.id, SENDER_INFO_SETTING_ID));
  await db.delete(users);
  await db.insert(users).values({
    id: USER_ID,
    pseudonymousId: 'pseudonymous-0',
    email: 'user0@launch.example',
    passwordHash: 'hash',
    nickname: '利用者0',
    handle: 'user0',
    termsAgreedAt: AT,
  });
});

describe('送信者情報の初期データ', () => {
  test('マイグレーションの適用後に、固定のIDと日時で3項目が未設定の版0の行が1件だけある', async () => {
    expect(await db.select().from(notificationSenderSettings)).toEqual([
      {
        id: SENDER_INFO_SETTING_ID,
        settingKey: 'sender-info',
        businessName: null,
        contactEmail: null,
        postalAddress: null,
        version: 0,
        updatedByAdminId: null,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
    ]);
  });

  test('初期データのSQLを2回実行しても、失敗せず行は1件だけのままになる', async () => {
    await runSeed();
    await runSeed();

    expect(
      await db
        .select({ id: notificationSenderSettings.id })
        .from(notificationSenderSettings),
    ).toEqual([{ id: SENDER_INFO_SETTING_ID }]);
  });

  test('同じ鍵の行を別のIDで作れない', async () => {
    expect(
      await rejectionMessagesOf(
        db
          .insert(notificationSenderSettings)
          .values(senderSettingOf('sender-info', 0, EMPTY)),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: notification_sender_settings.setting_key',
      ),
    );
  });
});

describe('送信者情報の版と3項目', () => {
  test('版1以上で3項目がそろった行と、版0で3項目が未設定の行を受け付ける', async () => {
    await db
      .insert(notificationSenderSettings)
      .values([
        senderSettingOf('filled', 1, FILLED),
        senderSettingOf('empty', 0, EMPTY),
      ]);

    expect(
      await db.$count(
        notificationSenderSettings,
        ne(notificationSenderSettings.id, SENDER_INFO_SETTING_ID),
      ),
    ).toBe(2);
  });

  test('負の版を拒否する', async () => {
    expect(
      await rejectionMessagesOf(
        db
          .insert(notificationSenderSettings)
          .values(senderSettingOf('negative', -1, EMPTY)),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: notification_sender_settings_version_check',
      ),
    );
  });

  test.each([
    ['版0で値がある行', 0, FILLED],
    ['版0で1項目だけ値がある行', 0, { ...EMPTY, businessName: '運営者' }],
    ['版1で値が無い行', 1, EMPTY],
    ['版1で1項目が未設定の行', 1, { ...FILLED, postalAddress: null }],
  ])('%sを拒否する', async (_label, version, values) => {
    expect(
      await rejectionMessagesOf(
        db
          .insert(notificationSenderSettings)
          .values(senderSettingOf('invalid', version, values)),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: notification_sender_settings_values_by_version_check',
      ),
    );
  });

  test('初期データの行を3項目が未設定のまま版1へ進められない', async () => {
    expect(
      await rejectionMessagesOf(
        db
          .update(notificationSenderSettings)
          .set({ version: 1 })
          .where(eq(notificationSenderSettings.id, SENDER_INFO_SETTING_ID)),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: notification_sender_settings_values_by_version_check',
      ),
    );
  });
});

describe('受信設定と配信停止のトークンの種', () => {
  test('同じ利用者と種別の受信設定を2つ作れず、決まっていない種別を拒否する', async () => {
    await db
      .insert(notificationPreferences)
      .values({ userId: USER_ID, topic: 'match_preview', enabled: true });

    expect(
      await rejectionMessagesOf(
        db
          .insert(notificationPreferences)
          .values({ userId: USER_ID, topic: 'match_preview', enabled: false }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: notification_preferences.user_id, notification_preferences.topic',
      ),
    );
    expect(
      await rejectionMessagesOf(
        env.DB.prepare(
          "INSERT INTO notification_preferences (id, user_id, topic, enabled, created_at, updated_at) VALUES ('01JN0000000000000000000R01', ?, 'weekly_digest', 1, 0, 0)",
        )
          .bind(USER_ID)
          .run(),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: notification_preferences_topic_check',
      ),
    );
  });

  test('同じ利用者でも種別が違えば受信設定を作れる', async () => {
    await db.insert(notificationPreferences).values([
      { userId: USER_ID, topic: 'match_preview', enabled: true },
      { userId: USER_ID, topic: 'match_result', enabled: false },
      { userId: USER_ID, topic: 'followed_user_match', enabled: true },
      { userId: USER_ID, topic: 'followed_user_award', enabled: true },
    ]);

    expect(await db.$count(notificationPreferences)).toBe(4);
  });

  test('同じ利用者と種別の種と、同じ照合用のハッシュの種を2つ作れない', async () => {
    await db.insert(notificationUnsubscribeTokens).values({
      userId: USER_ID,
      topic: 'match_result',
      seed: 'seed-1',
      tokenHash: 'hash-1',
    });

    expect(
      await rejectionMessagesOf(
        db.insert(notificationUnsubscribeTokens).values({
          userId: USER_ID,
          topic: 'match_result',
          seed: 'seed-2',
          tokenHash: 'hash-2',
        }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: notification_unsubscribe_tokens.user_id, notification_unsubscribe_tokens.topic',
      ),
    );
    expect(
      await rejectionMessagesOf(
        db.insert(notificationUnsubscribeTokens).values({
          userId: USER_ID,
          topic: 'match_preview',
          seed: 'seed-3',
          tokenHash: 'hash-1',
        }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: notification_unsubscribe_tokens.token_hash',
      ),
    );
  });

  test('存在しない利用者の受信設定・種・通知を作れない', async () => {
    expect(
      await rejectionMessagesOf(
        db.insert(notificationPreferences).values({
          userId: MISSING_USER_ID,
          topic: 'match_preview',
          enabled: true,
        }),
      ),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));
    expect(
      await rejectionMessagesOf(
        db.insert(notificationUnsubscribeTokens).values({
          userId: MISSING_USER_ID,
          topic: 'match_preview',
          seed: 'seed-1',
          tokenHash: 'hash-1',
        }),
      ),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));
    expect(
      await rejectionMessagesOf(
        db
          .insert(notificationNotices)
          .values(noticeOf('match_result:missing', MISSING_USER_ID)),
      ),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));
  });

  test('受信設定・種・通知の行がある利用者は、それらを消すまで物理削除できない', async () => {
    await db
      .insert(notificationPreferences)
      .values({ userId: USER_ID, topic: 'match_preview', enabled: true });

    expect(
      await rejectionMessagesOf(db.delete(users).where(eq(users.id, USER_ID))),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));

    await db.delete(notificationPreferences);
    await db.delete(users).where(eq(users.id, USER_ID));

    expect(await db.$count(users)).toBe(0);
  });
});

describe('通知イベント', () => {
  test('同じ重複のキーの通知イベントを2つ作れない', async () => {
    await db.insert(notificationEvents).values(eventOf('match_result:M01'));

    expect(
      await rejectionMessagesOf(
        db.insert(notificationEvents).values(eventOf('match_result:M01')),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: notification_events.dedupe_key',
      ),
    );
  });

  test('存在しないマッチ・プロダクトのIDでも通知イベントを作れる', async () => {
    await db.insert(notificationEvents).values([
      eventOf('match_result:M01'),
      {
        type: 'award',
        dedupeKey: 'award:product_of_the_week:2026-W46:P01',
        publisher: 'tournament-week',
        award: 'product_of_the_week',
        period: '2026-W46',
        productId: '01JN0000000000000000000P99',
        occurredAt: AT,
        lastDispatchedAt: AT,
      },
    ]);

    expect(await db.$count(notificationEvents)).toBe(2);
  });

  test.each([
    ['type', 'weekly', 'notification_events_type_check'],
    ['status', 'failed', 'notification_events_status_check'],
    ['award', 'product_of_the_day', 'notification_events_award_check'],
  ])('%sに決まっていない値%sを拒否する', async (column, value, checkName) => {
    const values = {
      type: 'award',
      status: 'pending',
      award: 'product_of_the_week',
      [column]: value,
    };

    expect(
      await rejectionMessagesOf(
        env.DB.prepare(
          "INSERT INTO notification_events (id, type, dedupe_key, publisher, award, status, occurred_at, dispatch_count, last_dispatched_at, created_at, updated_at) VALUES ('01JN0000000000000000000E01', ?, 'award:x', 'tournament-week', ?, ?, 0, 1, 0, 0, 0)",
        )
          .bind(values.type, values.award, values.status)
          .run(),
      ),
    ).toContainEqual(
      expect.stringContaining(`CHECK constraint failed: ${checkName}`),
    );
  });
});

describe('送信枠と準備の完了', () => {
  test('同じキーの送信枠を2つ作れない', async () => {
    await db.insert(notificationSlots).values(slotOf('evening:2026-11-14'));

    expect(
      await rejectionMessagesOf(
        db.insert(notificationSlots).values(slotOf('evening:2026-11-14')),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: notification_slots.slot_key',
      ),
    );
  });

  test('送り出しの前提の一覧をJSONの配列で保存して読み出し、依頼の時刻を記録できる', async () => {
    await db.insert(notificationSlots).values({
      ...slotOf('evening:2026-11-14'),
      requiredParticipants: ['tournament-week', 'tournament-year'],
      dispatchRequestedAt: AT,
    });

    expect(
      await db
        .select({
          requiredParticipants: notificationSlots.requiredParticipants,
          dispatchRequestedAt: notificationSlots.dispatchRequestedAt,
          phase: notificationSlots.phase,
        })
        .from(notificationSlots),
    ).toEqual([
      {
        requiredParticipants: ['tournament-week', 'tournament-year'],
        dispatchRequestedAt: AT,
        phase: 'waiting',
      },
    ]);
  });

  test.each([
    ['kind', 'weekly', 'notification_slots_kind_check'],
    ['phase', 'failed', 'notification_slots_phase_check'],
  ])('%sに決まっていない値%sを拒否する', async (column, value, checkName) => {
    const values = { kind: 'evening', phase: 'waiting', [column]: value };

    expect(
      await rejectionMessagesOf(
        env.DB.prepare(
          "INSERT INTO notification_slots (id, slot_key, kind, due_at, settle_until, phase, created_at, updated_at) VALUES ('01JN0000000000000000000S01', 'evening:x', ?, 0, 0, ?, 0, 0)",
        )
          .bind(values.kind, values.phase)
          .run(),
      ),
    ).toContainEqual(
      expect.stringContaining(`CHECK constraint failed: ${checkName}`),
    );
  });

  test('同じ枠と前提の機能の準備の完了を2つ作れず、送信枠の行が無くても作れる', async () => {
    await db.insert(notificationSlotReadyMarks).values({
      slotKey: 'evening:2026-11-14',
      participant: 'tournament-week',
      createdAt: AT,
    });
    await db.insert(notificationSlotReadyMarks).values({
      slotKey: 'evening:2026-11-14',
      participant: 'tournament-year',
      createdAt: AT,
    });

    expect(
      await rejectionMessagesOf(
        db.insert(notificationSlotReadyMarks).values({
          slotKey: 'evening:2026-11-14',
          participant: 'tournament-week',
          createdAt: AT,
        }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: notification_slot_ready_marks.slot_key, notification_slot_ready_marks.participant',
      ),
    );
    expect(await db.$count(notificationSlotReadyMarks)).toBe(2);
  });
});

describe('通知', () => {
  test('同じ重複のキーの通知を2つ作れない', async () => {
    await db
      .insert(notificationNotices)
      .values(noticeOf('match_result:M01:U01'));

    expect(
      await rejectionMessagesOf(
        db.insert(notificationNotices).values(noticeOf('match_result:M01:U01')),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: notification_notices.dedupe_key',
      ),
    );
  });

  test('存在しないマッチ・側・プロダクト・通知イベント・送信枠を指しても通知を作れる', async () => {
    await db
      .insert(notificationNotices)
      .values(noticeOf('match_result:M01:U01'));

    expect(
      await db
        .select({ status: notificationNotices.status })
        .from(notificationNotices),
    ).toEqual([{ status: 'pending' }]);
  });

  test('送らない理由を付けて送らないに確定できる', async () => {
    await db.insert(notificationNotices).values({
      ...noticeOf('match_result:M01:U01'),
      status: 'skipped',
      skipReason: 'recipient_withdrawn',
      settledAt: AT,
    });

    expect(await db.$count(notificationNotices)).toBe(1);
  });

  test.each([
    ['topic', 'weekly_digest', 'notification_notices_topic_check'],
    ['status', 'failed', 'notification_notices_status_check'],
    ['skip_reason', 'unknown', 'notification_notices_skip_reason_check'],
  ])('%sに決まっていない値%sを拒否する', async (column, value, checkName) => {
    const values = {
      topic: 'match_result',
      status: 'skipped',
      skip_reason: 'stale',
      [column]: value,
    };

    expect(
      await rejectionMessagesOf(
        env.DB.prepare(
          "INSERT INTO notification_notices (id, dedupe_key, slot_key, group_key, topic, recipient_user_id, status, skip_reason, created_at, updated_at) VALUES ('01JN0000000000000000000T01', 'match_result:x', 'evening:x', 'evening:x:u', ?, ?, ?, ?, 0, 0)",
        )
          .bind(values.topic, USER_ID, values.status, values.skip_reason)
          .run(),
      ),
    ).toContainEqual(
      expect.stringContaining(`CHECK constraint failed: ${checkName}`),
    );
  });
});
