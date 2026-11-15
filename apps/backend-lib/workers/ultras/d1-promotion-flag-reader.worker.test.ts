import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { ULTRAS_PROMOTION_FLAG_KEY } from '../../../common-lib/ultras/promotion-flag.ts';
import { ultrasSettings } from '../../../db/schema/ultras/ultras-settings.ts';
import { D1PromotionFlagReader } from './d1-promotion-flag-reader.ts';
import {
  db,
  restoreUltrasSettingsSeed,
  T0,
  ULTRAS_PROMOTION_SEED_ROW,
} from './testing/ultras-store-fixtures.ts';

const reader = new D1PromotionFlagReader(db);

beforeEach(async () => {
  await restoreUltrasSettingsSeed();
});

describe('D1PromotionFlagReaderの機能フラグの読み取り', () => {
  test('初期行はオフを返す', async () => {
    expect(await reader.isEnabled()).toBe(false);
  });

  test('初期行が有効に変われば、版や管理者の記録を問わずオンを返す', async () => {
    await db
      .update(ultrasSettings)
      .set({ enabled: true })
      .where(eq(ultrasSettings.settingKey, ULTRAS_PROMOTION_FLAG_KEY));

    expect(await reader.isEnabled()).toBe(true);
  });

  test('行が無ければ既定のオフを返し、他の設定キーの行の値を読まない', async () => {
    await db
      .delete(ultrasSettings)
      .where(eq(ultrasSettings.settingKey, ULTRAS_PROMOTION_FLAG_KEY));
    await db.insert(ultrasSettings).values({
      id: '01M6Q2FD000000000000000002',
      settingKey: 'other_setting',
      enabled: true,
      createdAt: T0,
      updatedAt: T0,
    });

    expect(await reader.isEnabled()).toBe(false);
  });
});

describe('機能フラグの初期行の入れ直し', () => {
  test('初期行をマイグレーションと同じ固定のIDと日時の行だけに戻す', async () => {
    await db.delete(ultrasSettings);

    await restoreUltrasSettingsSeed();

    expect(await db.select().from(ultrasSettings)).toEqual([
      ULTRAS_PROMOTION_SEED_ROW,
    ]);
  });
});
