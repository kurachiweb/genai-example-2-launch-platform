import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { ULTRAS_PROMOTION_UPDATE_ACTION } from '../../../common-lib/admin/audit-actions/ultras-subscription.ts';
import { ULTRAS_PROMOTION_FLAG_KEY } from '../../../common-lib/ultras/promotion-flag.ts';
import { createDatabase } from '../../../db/client.ts';
import { adminAuditLogs } from '../../../db/schema/admin/admin-audit-logs.ts';
import { ultrasSettings } from '../../../db/schema/ultras/ultras-settings.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import {
  db,
  restoreUltrasSettingsSeed,
  ULTRAS_PROMOTION_SEED_ROW,
} from '../../../lib/workers/ultras/testing/ultras-store-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import {
  createFailingD1,
  FAILING_D1_MESSAGE,
} from '../../../test/support/failing-d1.ts';
import { ULTRAS_ERRORS } from '../../application/ultras/ultras-errors.ts';
import {
  adminIdOf,
  auditLogIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  createSequentialAuditLogIds,
  readAuditLogTargetIds,
} from '../admin/testing/admin-store-fixtures.ts';
import { D1PromotionSettingWriter } from './d1-promotion-setting-writer.ts';

const OPERATOR = 1;

const NOW = new Date('2026-11-07T12:34:56.000Z');

const LATER = new Date('2026-11-07T13:00:00.000Z');

// 1つのテストの中で準備する監査ログの識別子を1から順に振る
let auditLogIds: IdGenerator = createSequentialAuditLogIds();

function auditOf(
  enabled: boolean,
  options: { readonly reason?: string; readonly occurredAt?: Date } = {},
): PreparedAuditEntry {
  return createAuditLogRecorder({ ids: auditLogIds }).prepare({
    operatorAdminId: adminIdOf(OPERATOR),
    action: ULTRAS_PROMOTION_UPDATE_ACTION.name,
    targetIds: [ULTRAS_PROMOTION_SEED_ROW.id],
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    detail: { enabled: String(enabled) },
    occurredAt: options.occurredAt ?? NOW,
  });
}

async function readSettingRow() {
  const [row] = await db
    .select()
    .from(ultrasSettings)
    .where(eq(ultrasSettings.settingKey, ULTRAS_PROMOTION_FLAG_KEY));
  return row;
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

beforeEach(async () => {
  await clearAdminTables();
  await restoreUltrasSettingsSeed();
  auditLogIds = createSequentialAuditLogIds();
});

describe('D1PromotionSettingWriter', () => {
  describe('read', () => {
    test('機能フラグの初期行を、鍵の行のID・値・版・更新日時・最後に変更した管理者(無し)として返す', async () => {
      await expect(new D1PromotionSettingWriter(db).read()).resolves.toEqual({
        id: ULTRAS_PROMOTION_SEED_ROW.id,
        enabled: false,
        version: 0,
        updatedAt: ULTRAS_PROMOTION_SEED_ROW.updatedAt,
        updatedByAdminId: null,
      });
    });

    test('鍵の行が無ければundefinedを返す', async () => {
      await db.delete(ultrasSettings);

      await expect(
        new D1PromotionSettingWriter(db).read(),
      ).resolves.toBeUndefined();
    });
  });

  describe('write', () => {
    test('読み取った版と一致すれば、値・版(+1)・変更した管理者・更新日時を書き、監査ログと対象を同じ1つの一括の書き込みで確定させる', async () => {
      const recording = createBatchRecordingD1(env.DB);
      const writer = new D1PromotionSettingWriter(createDatabase(recording.d1));

      await writer.write(
        {
          enabled: true,
          expectedVersion: 0,
          adminId: adminIdOf(OPERATOR),
          now: NOW,
        },
        auditOf(true, { reason: 'Stripeの準備が整った' }),
      );

      await expect(readSettingRow()).resolves.toEqual({
        ...ULTRAS_PROMOTION_SEED_ROW,
        enabled: true,
        version: 1,
        updatedByAdminId: adminIdOf(OPERATOR),
        updatedAt: NOW,
      });
      await expect(readAuditLogRows()).resolves.toEqual([
        {
          id: auditLogIdOf(1),
          operatorAdminId: adminIdOf(OPERATOR),
          action: ULTRAS_PROMOTION_UPDATE_ACTION.name,
          targetKind: 'setting',
          reason: 'Stripeの準備が整った',
          detail: { enabled: 'true' },
          occurredAt: NOW,
        },
      ]);
      await expect(readAuditLogTargetIds()).resolves.toEqual([
        ULTRAS_PROMOTION_SEED_ROW.id,
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.batches[0]).toHaveLength(3);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('版が1つ進むたびに次の書き込みは進んだ版を求め、連続した変更を重ねられる', async () => {
      const writer = new D1PromotionSettingWriter(db);
      await writer.write(
        { enabled: true, expectedVersion: 0, adminId: adminIdOf(1), now: NOW },
        auditOf(true),
      );

      await writer.write(
        {
          enabled: false,
          expectedVersion: 1,
          adminId: adminIdOf(2),
          now: LATER,
        },
        auditOf(false, { occurredAt: LATER }),
      );

      await expect(readSettingRow()).resolves.toEqual(
        expect.objectContaining({
          enabled: false,
          version: 2,
          updatedByAdminId: adminIdOf(2),
          updatedAt: LATER,
        }),
      );
      await expect(readAuditLogRows()).resolves.toHaveLength(2);
    });

    test('読み取った版が最新でなければversion_conflictで失敗し、設定も監査ログも対象も変えない', async () => {
      const writer = new D1PromotionSettingWriter(db);
      await writer.write(
        { enabled: true, expectedVersion: 0, adminId: adminIdOf(1), now: NOW },
        auditOf(true),
      );
      const before = await readSettingRow();

      const failure = writer.write(
        {
          enabled: false,
          expectedVersion: 0,
          adminId: adminIdOf(2),
          now: LATER,
        },
        auditOf(false, { occurredAt: LATER }),
      );

      await expect(failure).rejects.toBeInstanceOf(AppError);
      await expect(failure).rejects.toMatchObject({
        kind: 'conflict',
        code: 'version_conflict',
        message: ULTRAS_ERRORS.version_conflict.message,
      });
      await expect(readSettingRow()).resolves.toEqual(before);
      await expect(readAuditLogRows()).resolves.toEqual([
        expect.objectContaining({ id: auditLogIdOf(1), occurredAt: NOW }),
      ]);
      await expect(readAuditLogTargetIds()).resolves.toEqual([
        ULTRAS_PROMOTION_SEED_ROW.id,
      ]);
    });

    test('鍵の行が無ければ一致する版が無いためversion_conflictで失敗し、監査ログを残さない', async () => {
      await db.delete(ultrasSettings);

      await expect(
        new D1PromotionSettingWriter(db).write(
          {
            enabled: true,
            expectedVersion: 0,
            adminId: adminIdOf(OPERATOR),
            now: NOW,
          },
          auditOf(true),
        ),
      ).rejects.toMatchObject({ code: 'version_conflict' });
      await expect(readAuditLogRows()).resolves.toEqual([]);
    });

    test('版の照合以外の失敗はそのまま投げ直す', async () => {
      const writer = new D1PromotionSettingWriter(
        createDatabase(createFailingD1()),
      );

      const write = () =>
        writer.write(
          {
            enabled: true,
            expectedVersion: 0,
            adminId: adminIdOf(OPERATOR),
            now: NOW,
          },
          auditOf(true),
        );

      await expect(failureMessagesOf(write())).resolves.toContain(
        FAILING_D1_MESSAGE,
      );
      await expect(write()).rejects.not.toBeInstanceOf(AppError);
    });
  });
});
