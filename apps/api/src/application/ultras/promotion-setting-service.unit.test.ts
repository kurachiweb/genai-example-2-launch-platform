import { describe, expect, test } from 'bun:test';

import { ULTRAS_PROMOTION_UPDATE_ACTION } from '../../../common-lib/admin/audit-actions/ultras-subscription.ts';
import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import type {
  AdminDirectory,
  AdminProfileView,
} from '../../../lib/core/admin/ports.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  PromotionSettingReader,
  PromotionSettingRecord,
  PromotionSettingUpdate,
  PromotionSettingWriter,
} from './promotion-setting-ports.ts';
import { DefaultPromotionSettingService } from './promotion-setting-service.ts';
import { ultrasError } from './ultras-errors.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');
const UPDATED_AT = new Date('2027-03-01T00:00:00.000Z');
const SETTING_ID = '01M6Q2FD000000000000000001';
const SUPER_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';
const DELETED_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRV';
const AUDIT_LOG_ID = '01JD0000000000000000AUDIT1';

const PROFILES: ReadonlyMap<string, AdminProfileView> = new Map([
  [
    SUPER_ADMIN_ID,
    {
      id: SUPER_ADMIN_ID,
      nickname: '運営の山田',
      title: '代表',
      avatarFileId: null,
    },
  ],
]);

const fixedClock: Clock = { now: () => new Date(NOW) };

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否される想定です');
}

function recordOf(
  overrides: Partial<PromotionSettingRecord> = {},
): PromotionSettingRecord {
  return {
    id: SETTING_ID,
    enabled: false,
    version: 3,
    updatedAt: UPDATED_AT,
    updatedByAdminId: SUPER_ADMIN_ID,
    ...overrides,
  };
}

interface FakeOptions {
  readonly records?: readonly (PromotionSettingRecord | undefined)[];
  readonly writeError?: Error;
}

// 読み取りは呼ばれるたびに次の行を返し、変更の後の読み直しを再現する
function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const prepared: AuditEntryInput[] = [];
  const writes: {
    readonly update: PromotionSettingUpdate;
    readonly audit: PreparedAuditEntry;
  }[] = [];
  const lookedUp: (readonly string[])[] = [];
  const records = [...(options.records ?? [recordOf()])];
  const reader: PromotionSettingReader = {
    read: () => {
      calls.push('read');
      const next = records.length > 1 ? records.shift() : records[0];
      return Promise.resolve(next);
    },
  };
  const writer: PromotionSettingWriter = {
    write: (update, audit) => {
      calls.push('write');
      writes.push({ update, audit });
      return options.writeError === undefined
        ? Promise.resolve()
        : Promise.reject(options.writeError);
    },
  };
  const auditLog: AuditLogRecorder = {
    prepare: (entry) => {
      calls.push('prepare');
      prepared.push(entry);
      return {
        id: AUDIT_LOG_ID,
        operatorAdminId: entry.operatorAdminId,
        action: entry.action,
        targetKind: 'setting',
        targetIds: entry.targetIds,
        reason: entry.reason ?? null,
        detail: entry.detail ?? {},
        occurredAt: entry.occurredAt,
      } as PreparedAuditEntry;
    },
    record: () => Promise.reject(new Error('recordは呼ばれない')),
  };
  const directory: AdminDirectory = {
    findProfiles: (ids) => {
      calls.push('findProfiles');
      lookedUp.push(ids);
      return Promise.resolve(
        new Map([...PROFILES].filter(([id]) => ids.includes(id))),
      );
    },
  };
  const service = new DefaultPromotionSettingService(
    reader,
    writer,
    auditLog,
    directory,
    fixedClock,
  );
  return { service, calls, prepared, writes, lookedUp };
}

describe('DefaultPromotionSettingService', () => {
  describe('read', () => {
    test('設定の行と最後に変更した管理者のニックネームを返す', async () => {
      const { service, lookedUp } = setup();

      expect(await service.read()).toEqual({
        enabled: false,
        version: 3,
        updatedAt: UPDATED_AT,
        updatedByNickname: '運営の山田',
      });
      expect(lookedUp).toEqual([[SUPER_ADMIN_ID]]);
    });

    test('最後に変更した管理者が削除済みならニックネームをnullにする', async () => {
      const { service } = setup({
        records: [recordOf({ updatedByAdminId: DELETED_ADMIN_ID })],
      });

      const view = await service.read();

      expect(view.updatedByNickname).toBeNull();
      expect(view.version).toBe(3);
    });

    test('まだ管理者が変更していなければ管理者の照会をせずニックネームをnullにする', async () => {
      const { service, calls } = setup({
        records: [recordOf({ version: 0, updatedByAdminId: null })],
      });

      expect(await service.read()).toEqual({
        enabled: false,
        version: 0,
        updatedAt: UPDATED_AT,
        updatedByNickname: null,
      });
      expect(calls).toEqual(['read']);
    });

    test('設定の行が無ければ初期値のオフを版0として返す', async () => {
      const { service, calls } = setup({ records: [undefined] });

      expect(await service.read()).toEqual({
        enabled: false,
        version: 0,
        updatedAt: null,
        updatedByNickname: null,
      });
      expect(calls).toEqual(['read']);
    });
  });

  describe('update', () => {
    test('受け取った管理者のIDで、操作種別・設定の行の対象・詳細のenabledを持つ監査ログの記録を準備し、同じ準備済みの値で書き込む', async () => {
      const { service, prepared, writes } = setup();

      await service.update({
        adminId: SUPER_ADMIN_ID,
        enabled: true,
        expectedVersion: 3,
        reason: 'キャンペーンの開始',
      });

      expect(prepared).toEqual([
        {
          operatorAdminId: SUPER_ADMIN_ID,
          action: ULTRAS_PROMOTION_UPDATE_ACTION.name,
          targetIds: [SETTING_ID],
          reason: 'キャンペーンの開始',
          detail: { enabled: 'true' },
          occurredAt: NOW,
        },
      ]);
      expect(writes).toEqual([
        {
          update: {
            enabled: true,
            expectedVersion: 3,
            adminId: SUPER_ADMIN_ID,
            now: NOW,
          },
          audit: expect.objectContaining({
            id: AUDIT_LOG_ID,
            action: ULTRAS_PROMOTION_UPDATE_ACTION.name,
          }) as PreparedAuditEntry,
        },
      ]);
    });

    test.each([
      ['省略', undefined],
      ['空文字', ''],
      ['空白だけ', ' 　\n'],
    ])(
      '理由が%sなら監査ログの記録の準備に理由を含めない',
      async (_, reason) => {
        const { service, prepared } = setup();

        await service.update({
          adminId: SUPER_ADMIN_ID,
          enabled: false,
          expectedVersion: 3,
          ...(reason === undefined ? {} : { reason }),
        });

        expect(prepared).toEqual([
          {
            operatorAdminId: SUPER_ADMIN_ID,
            action: ULTRAS_PROMOTION_UPDATE_ACTION.name,
            targetIds: [SETTING_ID],
            detail: { enabled: 'false' },
            occurredAt: NOW,
          },
        ]);
        expect(prepared[0]).not.toHaveProperty('reason');
      },
    );

    test('準備→書き込みの順に行い、書き込みの後に読み直した最新の設定を返す', async () => {
      const { service, calls } = setup({
        records: [
          recordOf({ version: 3, updatedByAdminId: null }),
          recordOf({ enabled: true, version: 4, updatedAt: NOW }),
        ],
      });

      const view = await service.update({
        adminId: SUPER_ADMIN_ID,
        enabled: true,
        expectedVersion: 3,
      });

      expect(calls).toEqual([
        'read',
        'prepare',
        'write',
        'read',
        'findProfiles',
      ]);
      expect(view).toEqual({
        enabled: true,
        version: 4,
        updatedAt: NOW,
        updatedByNickname: '運営の山田',
      });
    });

    test('書き込みの版の競合(version_conflict)はそのまま投げる', async () => {
      const { service } = setup({
        writeError: ultrasError('version_conflict'),
      });

      const error = await rejectionOf(
        service.update({
          adminId: SUPER_ADMIN_ID,
          enabled: true,
          expectedVersion: 2,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: 'version_conflict',
        kind: 'conflict',
      });
    });

    test('設定の行が無ければ監査ログの準備も書き込みもせずに失敗する', async () => {
      const { service, calls } = setup({ records: [undefined] });

      const error = await rejectionOf(
        service.update({
          adminId: SUPER_ADMIN_ID,
          enabled: true,
          expectedVersion: 0,
        }),
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('機能フラグの設定の行がありません');
      expect(calls).toEqual(['read']);
    });
  });
});
