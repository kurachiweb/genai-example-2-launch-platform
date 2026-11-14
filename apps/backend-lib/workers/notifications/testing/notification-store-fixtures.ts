import { asc, eq } from 'drizzle-orm';

import type { NotificationTopic } from '../../../../common-lib/notifications/notification-topics.ts';
import { notificationNotices } from '../../../../db/schema/notifications/notification-notices.ts';
import { notificationPreferences } from '../../../../db/schema/notifications/notification-preferences.ts';
import { notificationSenderSettings } from '../../../../db/schema/notifications/notification-sender-settings.ts';
import { notificationUnsubscribeTokens } from '../../../../db/schema/notifications/notification-unsubscribe-tokens.ts';
import {
  after,
  clearIdentityTables,
  db,
  insertUser,
  insertUsers,
  T0,
  userIdOf,
} from '../../identity/testing/identity-store-fixtures.ts';
import { SENDER_INFO_SETTING_KEY } from '../d1-sender-info-store.ts';

export { after, db, insertUser, insertUsers, T0, userIdOf };

// 1行が6個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const PREFERENCE_ROWS_PER_INSERT = 15;

type PreferenceRow = typeof notificationPreferences.$inferInsert;
type SenderSettingsRow = typeof notificationSenderSettings.$inferSelect;

const SENDER_INFO_SEEDED_AT = new Date(1_794_614_400_000);

// マイグレーション(_notifications_seed)が入れる送信者情報の初期行と同じ固定のIDと日時
export const SENDER_INFO_SEED_ROW: SenderSettingsRow = {
  id: '01M7BNN5000000000000000001',
  settingKey: SENDER_INFO_SETTING_KEY,
  businessName: null,
  contactEmail: null,
  postalAddress: null,
  version: 0,
  updatedByAdminId: null,
  createdAt: SENDER_INFO_SEEDED_AT,
  updatedAt: SENDER_INFO_SEEDED_AT,
};

function preferenceRowOf(
  userIndex: number,
  topic: NotificationTopic,
  enabled: boolean,
): PreferenceRow {
  return {
    userId: userIdOf(userIndex),
    topic,
    enabled,
    createdAt: T0,
    updatedAt: T0,
  };
}

export async function insertPreference(
  userIndex: number,
  topic: NotificationTopic,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values(preferenceRowOf(userIndex, topic, enabled));
}

export async function insertPreferences(
  userIndexes: readonly number[],
  topic: NotificationTopic,
  enabled: boolean,
): Promise<void> {
  const rows = userIndexes.map((index) =>
    preferenceRowOf(index, topic, enabled),
  );
  for (
    let start = 0;
    start < rows.length;
    start += PREFERENCE_ROWS_PER_INSERT
  ) {
    await db
      .insert(notificationPreferences)
      .values(rows.slice(start, start + PREFERENCE_ROWS_PER_INSERT));
  }
}

export async function readPreferencesOf(userIndex: number) {
  return db
    .select({
      topic: notificationPreferences.topic,
      enabled: notificationPreferences.enabled,
      createdAt: notificationPreferences.createdAt,
      updatedAt: notificationPreferences.updatedAt,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userIdOf(userIndex)))
    .orderBy(asc(notificationPreferences.topic));
}

export async function restoreSenderInfoSeed(): Promise<void> {
  await db.delete(notificationSenderSettings);
  await db.insert(notificationSenderSettings).values(SENDER_INFO_SEED_ROW);
}

// 送信者情報の初期行はマイグレーションが入れるため消さない
export async function clearNotificationTables(): Promise<void> {
  await db.delete(notificationNotices);
  await db.delete(notificationUnsubscribeTokens);
  await db.delete(notificationPreferences);
  await clearIdentityTables();
}
