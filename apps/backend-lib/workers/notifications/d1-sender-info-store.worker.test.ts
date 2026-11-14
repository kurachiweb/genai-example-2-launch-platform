import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { notificationSenderSettings } from '../../../db/schema/notifications/notification-sender-settings.ts';
import { D1SenderInfoStore } from './d1-sender-info-store.ts';
import {
  after,
  db,
  restoreSenderInfoSeed,
  SENDER_INFO_SEED_ROW,
  T0,
} from './testing/notification-store-fixtures.ts';

const ADMIN_ID = '01JC0ADMN00000000000000001';

const SENDER_INFO = {
  businessName: 'ローンチ運営事務局',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都千代田区1-1-1',
} as const;

const store = new D1SenderInfoStore(db);

beforeEach(async () => {
  await restoreSenderInfoSeed();
});

describe('D1SenderInfoStoreの送信者情報の読み取り', () => {
  test('シードの版0の行は、値をundefinedにしてシードの固定のIDと版0を返す', async () => {
    expect(await store.get()).toEqual({
      settingId: SENDER_INFO_SEED_ROW.id,
      version: 0,
      info: undefined,
      updatedAt: SENDER_INFO_SEED_ROW.updatedAt,
      updatedByAdminId: null,
    });
  });

  test('設定済みの行は、値と版と変更者を、シードの固定のIDとともに返す', async () => {
    await db
      .update(notificationSenderSettings)
      .set({
        ...SENDER_INFO,
        version: 3,
        updatedByAdminId: ADMIN_ID,
        updatedAt: after(10),
      })
      .where(eq(notificationSenderSettings.id, SENDER_INFO_SEED_ROW.id));

    expect(await store.get()).toEqual({
      settingId: SENDER_INFO_SEED_ROW.id,
      version: 3,
      info: SENDER_INFO,
      updatedAt: after(10),
      updatedByAdminId: ADMIN_ID,
    });
  });

  test('シードの行が無ければundefinedを返し、他の設定のキーの行を読まない', async () => {
    await db.delete(notificationSenderSettings);
    await db.insert(notificationSenderSettings).values({
      id: '01M7BNN5000000000000000002',
      settingKey: 'other-setting',
      ...SENDER_INFO,
      version: 1,
      createdAt: T0,
      updatedAt: T0,
    });

    expect(await store.get()).toBeUndefined();
  });
});

describe('送信者情報の初期行の入れ直し', () => {
  test('初期行をマイグレーションと同じ固定のIDと日時の行だけに戻す', async () => {
    await db.delete(notificationSenderSettings);

    await restoreSenderInfoSeed();

    expect(await db.select().from(notificationSenderSettings)).toEqual([
      SENDER_INFO_SEED_ROW,
    ]);
  });
});
