import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { notificationSenderSettings } from '../../../db/schema/notifications/notification-sender-settings.ts';
import { D1SenderInfoStore } from '../../../lib/workers/notifications/d1-sender-info-store.ts';
import {
  after,
  db,
  restoreSenderInfoSeed,
  SENDER_INFO_SEED_ROW,
} from '../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { D1SenderInfoProvider } from './d1-sender-info-provider.ts';

const SENDER_INFO = {
  businessName: 'ローンチ運営事務局',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都千代田区1-1-1',
} as const;

const UPDATED_SENDER_INFO = {
  businessName: 'ローンチ運営事務局(新)',
  contactEmail: 'help@launch.example',
  postalAddress: '大阪府大阪市北区2-2-2',
} as const;

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const provider = new D1SenderInfoProvider(new D1SenderInfoStore(db));

async function saveSenderInfo(
  info: typeof SENDER_INFO | typeof UPDATED_SENDER_INFO,
  version: number,
): Promise<void> {
  await db
    .update(notificationSenderSettings)
    .set({ ...info, version, updatedAt: after(version) })
    .where(eq(notificationSenderSettings.id, SENDER_INFO_SEED_ROW.id));
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await restoreSenderInfoSeed();
});

describe('D1SenderInfoProviderによるメールの送信者情報の取得', () => {
  test('送信者情報が版0(未設定)なら、undefinedを返す', async () => {
    await expect(provider.get()).resolves.toBeUndefined();
  });

  test('送信者情報が設定済みなら、事業者名・連絡先メールアドレス・所在地の3項目だけを返す', async () => {
    await saveSenderInfo(SENDER_INFO, 1);

    await expect(provider.get()).resolves.toStrictEqual(SENDER_INFO);
  });

  test('送信者情報の行が無ければ、undefinedを返す', async () => {
    await db.delete(notificationSenderSettings);

    await expect(provider.get()).resolves.toBeUndefined();
  });

  test('値を持ち越さず、保存の直後の取得から新しい値を返す', async () => {
    await saveSenderInfo(SENDER_INFO, 1);
    await expect(provider.get()).resolves.toStrictEqual(SENDER_INFO);

    await saveSenderInfo(UPDATED_SENDER_INFO, 2);

    await expect(provider.get()).resolves.toStrictEqual(UPDATED_SENDER_INFO);
  });
});
