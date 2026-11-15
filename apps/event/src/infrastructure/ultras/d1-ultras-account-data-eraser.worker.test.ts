import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { ultrasActivations } from '../../../db/schema/ultras/ultras-activations.ts';
import { ultrasNotices } from '../../../db/schema/ultras/ultras-notices.ts';
import { ultrasSubscriptions } from '../../../db/schema/ultras/ultras-subscriptions.ts';
import { createRecordingDatabase } from '../../../lib/workers/payments/testing/payment-store-fixtures.ts';
import { D1ActivationStore } from '../../../lib/workers/ultras/d1-activation-store.ts';
import { D1NoticeStore } from '../../../lib/workers/ultras/d1-notice-store.ts';
import { D1SubscriptionStore } from '../../../lib/workers/ultras/d1-subscription-store.ts';
import {
  activatedSubscriptionRow,
  activationIdOf,
  clearUltrasTables,
  db,
  insertActivationRows,
  insertNoticeRows,
  insertSubscriptionRows,
  insertUser,
  newActivationRow,
  newNoticeRow,
  newSubscriptionRow,
  noticeIdOf,
  subscriptionIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/ultras/testing/ultras-store-fixtures.ts';
import type { UltrasAccountDataEraser } from '../../application/ultras/ultras-account-data-eraser.ts';
import { D1IdentityPurgeStore } from '../identity/d1-identity-purge-store.ts';
import { D1UltrasAccountDataEraser } from './d1-ultras-account-data-eraser.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const ERASED = 1;

const KEPT = 2;

interface UserUltrasRows {
  readonly subscriptionIds: readonly string[];
  readonly activationIds: readonly string[];
  readonly noticeIds: readonly string[];
}

function createEraser(database: Database = db): UltrasAccountDataEraser {
  return new D1UltrasAccountDataEraser(
    database,
    new D1NoticeStore(database),
    new D1ActivationStore(database),
    new D1SubscriptionStore(database),
  );
}

async function readUserUltrasRows(userIndex: number): Promise<UserUltrasRows> {
  const userId = userIdOf(userIndex);
  const subscriptionRows = await db
    .select({ id: ultrasSubscriptions.id })
    .from(ultrasSubscriptions)
    .where(eq(ultrasSubscriptions.userId, userId))
    .orderBy(asc(ultrasSubscriptions.id));
  const activationRows = await db
    .select({ id: ultrasActivations.id })
    .from(ultrasActivations)
    .where(eq(ultrasActivations.userId, userId))
    .orderBy(asc(ultrasActivations.id));
  const noticeRows = await db
    .select({ id: ultrasNotices.id })
    .from(ultrasNotices)
    .where(eq(ultrasNotices.userId, userId))
    .orderBy(asc(ultrasNotices.id));
  return {
    subscriptionIds: subscriptionRows.map(({ id }) => id),
    activationIds: activationRows.map(({ id }) => id),
    noticeIds: noticeRows.map(({ id }) => id),
  };
}

async function userRowExists(userIndex: number): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userIdOf(userIndex)));
  return rows.length === 1;
}

const ERASED_USER_ROWS: UserUltrasRows = {
  subscriptionIds: [subscriptionIdOf(1), subscriptionIdOf(3)],
  activationIds: [activationIdOf(1), activationIdOf(3)],
  noticeIds: [noticeIdOf(1), noticeIdOf(3)],
};

const KEPT_USER_ROWS: UserUltrasRows = {
  subscriptionIds: [subscriptionIdOf(2)],
  activationIds: [activationIdOf(2)],
  noticeIds: [noticeIdOf(2)],
};

const NO_ROWS: UserUltrasRows = {
  subscriptionIds: [],
  activationIds: [],
  noticeIds: [],
};

// 物理削除する退会者に、有効な加入と終了した加入・それぞれの知らせとメールの依頼を、行が残るべき別の利用者に1件ずつを入れる
async function arrangeErasedAndKeptUsers(): Promise<void> {
  await insertUser(ERASED, { deletedAt: new Date('2026-11-01T00:00:00.000Z') });
  await insertUser(KEPT);
  await insertSubscriptionRows([
    activatedSubscriptionRow(1),
    activatedSubscriptionRow(2, { userId: userIdOf(KEPT) }),
    newSubscriptionRow(3, {
      stripeStatus: 'canceled',
      startedAt: T0,
      endedAt: T0,
      benefitEndsAt: T0,
      benefitEndFixed: true,
    }),
  ]);
  await insertActivationRows([
    newActivationRow(1),
    newActivationRow(2, { userId: userIdOf(KEPT) }),
    newActivationRow(3),
  ]);
  await insertNoticeRows([
    newNoticeRow(1),
    newNoticeRow(2, { userId: userIdOf(KEPT) }),
    newNoticeRow(3),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearUltrasTables();
});

describe('D1UltrasAccountDataEraser.erase', () => {
  test('利用者の加入・知らせ・メールの依頼の行を3テーブルから消し、他の利用者の行は残す', async () => {
    await arrangeErasedAndKeptUsers();
    await expect(readUserUltrasRows(ERASED)).resolves.toStrictEqual(
      ERASED_USER_ROWS,
    );

    await expect(
      createEraser().erase(userIdOf(ERASED)),
    ).resolves.toBeUndefined();

    await expect(readUserUltrasRows(ERASED)).resolves.toStrictEqual(NO_ROWS);
    await expect(readUserUltrasRows(KEPT)).resolves.toStrictEqual(
      KEPT_USER_ROWS,
    );
  });

  test('Ultrasの行が残る間は利用者の行の物理削除が外部キーの違反で失敗し、削除の後は成功する', async () => {
    await arrangeErasedAndKeptUsers();
    const identityPurge = new D1IdentityPurgeStore(db);

    await expect(identityPurge.purge(userIdOf(ERASED))).rejects.toThrow();
    await expect(userRowExists(ERASED)).resolves.toBe(true);

    await createEraser().erase(userIdOf(ERASED));

    await expect(
      identityPurge.purge(userIdOf(ERASED)),
    ).resolves.toBeUndefined();
    await expect(userRowExists(ERASED)).resolves.toBe(false);
    await expect(userRowExists(KEPT)).resolves.toBe(true);
  });

  test('3つの削除の文を1回の一括の書き込みで確定する', async () => {
    await arrangeErasedAndKeptUsers();
    const { database, batchSizes } = createRecordingDatabase();

    await createEraser(database).erase(userIdOf(ERASED));

    expect(batchSizes).toStrictEqual([3]);
    await expect(readUserUltrasRows(ERASED)).resolves.toStrictEqual(NO_ROWS);
  });

  test('同じ利用者で2回呼んでも失敗せず、結果が変わらない', async () => {
    await arrangeErasedAndKeptUsers();
    const eraser = createEraser();
    await eraser.erase(userIdOf(ERASED));

    await expect(eraser.erase(userIdOf(ERASED))).resolves.toBeUndefined();

    await expect(readUserUltrasRows(ERASED)).resolves.toStrictEqual(NO_ROWS);
    await expect(readUserUltrasRows(KEPT)).resolves.toStrictEqual(
      KEPT_USER_ROWS,
    );
  });

  test('Ultrasの行が無い利用者でも失敗せずに終わる', async () => {
    await insertUser(ERASED, { deletedAt: T0 });

    await expect(
      createEraser().erase(userIdOf(ERASED)),
    ).resolves.toBeUndefined();
  });

  test('一括の書き込みの途中で失敗すると、知らせもメールの依頼も残して失敗を投げる', async () => {
    await arrangeErasedAndKeptUsers();
    await env.DB.exec(
      "CREATE TRIGGER ultras_subscriptions_delete_failure BEFORE DELETE ON ultras_subscriptions BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );

    try {
      await expect(createEraser().erase(userIdOf(ERASED))).rejects.toThrow();
    } finally {
      await env.DB.exec('DROP TRIGGER ultras_subscriptions_delete_failure');
    }
    await expect(readUserUltrasRows(ERASED)).resolves.toStrictEqual(
      ERASED_USER_ROWS,
    );
  });
});
