import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { NOTIFICATION_SENDER_UPDATE_ACTION } from '../../../common-lib/admin/audit-actions/notifications.ts';
import { createDatabase } from '../../../db/client.ts';
import { adminAuditLogs } from '../../../db/schema/admin/admin-audit-logs.ts';
import { notificationSenderSettings } from '../../../db/schema/notifications/notification-sender-settings.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type { SenderInfo } from '../../../lib/core/email/ports.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { D1SenderInfoStore } from '../../../lib/workers/notifications/d1-sender-info-store.ts';
import {
  db,
  restoreSenderInfoSeed,
  SENDER_INFO_SEED_ROW,
} from '../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import {
  createFailingD1,
  FAILING_D1_MESSAGE,
} from '../../../test/support/failing-d1.ts';
import {
  adminIdOf,
  auditLogIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  createSequentialAuditLogIds,
  readAuditLogTargetIds,
} from '../admin/testing/admin-store-fixtures.ts';
import { D1SenderInfoWriter } from './d1-sender-info-writer.ts';

const NOW = new Date('2026-11-20T03:00:00.000Z');

const LATER = new Date('2026-11-20T04:00:00.000Z');

const INFO: SenderInfo = {
  businessName: 'ローンチ運営事務局',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都千代田区1-1-1',
};

const MOVED: SenderInfo = { ...INFO, postalAddress: '大阪府大阪市4-5-6' };

// 1つのテストの中で準備する監査ログの識別子を1から順に振る
let auditLogIds: IdGenerator = createSequentialAuditLogIds();

function auditOf(
  operator: number,
  options: {
    readonly fields?: string;
    readonly reason?: string;
    readonly occurredAt?: Date;
  } = {},
): PreparedAuditEntry {
  return createAuditLogRecorder({ ids: auditLogIds }).prepare({
    operatorAdminId: adminIdOf(operator),
    action: NOTIFICATION_SENDER_UPDATE_ACTION.name,
    targetIds: [SENDER_INFO_SEED_ROW.id],
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    detail: {
      fields: options.fields ?? 'businessName,contactEmail,postalAddress',
    },
    occurredAt: options.occurredAt ?? NOW,
  });
}

function saveOf(
  operator: number,
  info: SenderInfo,
  expectedVersion: number,
  at: Date,
  audit: PreparedAuditEntry,
) {
  return { info, expectedVersion, adminId: adminIdOf(operator), audit, at };
}

async function readSettingRows() {
  return db.select().from(notificationSenderSettings);
}

async function readAuditLogRows() {
  return db
    .select({
      id: adminAuditLogs.id,
      operatorAdminId: adminAuditLogs.operatorAdminId,
      action: adminAuditLogs.action,
      targetKind: adminAuditLogs.targetKind,
      reason: adminAuditLogs.reason,
      detail: adminAuditLogs.detail,
      occurredAt: adminAuditLogs.occurredAt,
    })
    .from(adminAuditLogs)
    .orderBy(asc(adminAuditLogs.id));
}

// Drizzleの失敗はD1のエラーをcauseに持つため、原因をたどって文言を集める
async function failureMessagesOf(write: Promise<unknown>): Promise<string[]> {
  const messages: string[] = [];
  try {
    await write;
  } catch (error) {
    for (
      let current = error;
      current instanceof Error;
      current = current.cause
    ) {
      messages.push(current.message);
    }
  }
  return messages;
}

beforeEach(async () => {
  await clearAdminTables();
  await restoreSenderInfoSeed();
  auditLogIds = createSequentialAuditLogIds();
});

describe('D1SenderInfoWriter', () => {
  test('シードの版0の行への初回の保存は、3項目・版1・変更した管理者・更新日時を書き、監査ログと対象を同じ1つの一括の書き込みで確定させる', async () => {
    const recording = createBatchRecordingD1(env.DB);
    const writer = new D1SenderInfoWriter(createDatabase(recording.d1));

    await expect(
      writer.save(
        saveOf(1, INFO, 0, NOW, auditOf(1, { reason: '送信者情報の初期設定' })),
      ),
    ).resolves.toBe('saved');

    await expect(readSettingRows()).resolves.toEqual([
      {
        ...SENDER_INFO_SEED_ROW,
        ...INFO,
        version: 1,
        updatedByAdminId: adminIdOf(1),
        updatedAt: NOW,
      },
    ]);
    await expect(readAuditLogRows()).resolves.toEqual([
      {
        id: auditLogIdOf(1),
        operatorAdminId: adminIdOf(1),
        action: NOTIFICATION_SENDER_UPDATE_ACTION.name,
        targetKind: 'setting',
        reason: '送信者情報の初期設定',
        detail: { fields: 'businessName,contactEmail,postalAddress' },
        occurredAt: NOW,
      },
    ]);
    await expect(readAuditLogTargetIds()).resolves.toEqual([
      SENDER_INFO_SEED_ROW.id,
    ]);
    expect(recording.batches).toHaveLength(1);
    expect(recording.batches[0]).toHaveLength(3);
    expect(recording.statementsOutsideBatches()).toEqual([]);
  });

  test('保存した値は送信者情報のストアで読み直せ、続く更新は進んだ版を求めて版を2へ進める', async () => {
    const writer = new D1SenderInfoWriter(db);
    await writer.save(saveOf(1, INFO, 0, NOW, auditOf(1)));

    await expect(
      writer.save(
        saveOf(
          2,
          MOVED,
          1,
          LATER,
          auditOf(2, { fields: 'postalAddress', occurredAt: LATER }),
        ),
      ),
    ).resolves.toBe('saved');

    await expect(new D1SenderInfoStore(db).get()).resolves.toEqual({
      settingId: SENDER_INFO_SEED_ROW.id,
      version: 2,
      info: MOVED,
      updatedAt: LATER,
      updatedByAdminId: adminIdOf(2),
    });
    await expect(readAuditLogRows()).resolves.toEqual([
      expect.objectContaining({ id: auditLogIdOf(1), occurredAt: NOW }),
      expect.objectContaining({
        id: auditLogIdOf(2),
        operatorAdminId: adminIdOf(2),
        detail: { fields: 'postalAddress' },
        occurredAt: LATER,
      }),
    ]);
  });

  test('同じ版0からの2回目の保存はversion_conflictを返し、設定も監査ログも対象も変えない', async () => {
    const writer = new D1SenderInfoWriter(db);
    await writer.save(saveOf(1, INFO, 0, NOW, auditOf(1)));
    const before = await readSettingRows();

    await expect(
      writer.save(
        saveOf(2, MOVED, 0, LATER, auditOf(2, { occurredAt: LATER })),
      ),
    ).resolves.toBe('version_conflict');

    await expect(readSettingRows()).resolves.toEqual(before);
    await expect(readAuditLogRows()).resolves.toEqual([
      expect.objectContaining({ id: auditLogIdOf(1), occurredAt: NOW }),
    ]);
    await expect(readAuditLogTargetIds()).resolves.toEqual([
      SENDER_INFO_SEED_ROW.id,
    ]);
  });

  test('読み取った版が現在の版より新しくてもversion_conflictを返し、シードの行のまま監査ログを残さない', async () => {
    await expect(
      new D1SenderInfoWriter(db).save(saveOf(1, INFO, 1, NOW, auditOf(1))),
    ).resolves.toBe('version_conflict');

    await expect(readSettingRows()).resolves.toEqual([SENDER_INFO_SEED_ROW]);
    await expect(readAuditLogRows()).resolves.toEqual([]);
    await expect(readAuditLogTargetIds()).resolves.toEqual([]);
  });

  test('設定の行が無ければ挿入せずにversion_conflictを返し、監査ログを残さない', async () => {
    await db.delete(notificationSenderSettings);

    await expect(
      new D1SenderInfoWriter(db).save(saveOf(1, INFO, 0, NOW, auditOf(1))),
    ).resolves.toBe('version_conflict');

    await expect(readSettingRows()).resolves.toEqual([]);
    await expect(readAuditLogRows()).resolves.toEqual([]);
  });

  test('版の照合以外の失敗はそのまま投げ直す', async () => {
    const writer = new D1SenderInfoWriter(createDatabase(createFailingD1()));

    await expect(
      failureMessagesOf(writer.save(saveOf(1, INFO, 0, NOW, auditOf(1)))),
    ).resolves.toContain(FAILING_D1_MESSAGE);
  });
});
