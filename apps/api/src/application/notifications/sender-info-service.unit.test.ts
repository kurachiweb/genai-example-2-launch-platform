import { describe, expect, test } from 'bun:test';

import { Container } from 'inversify';

import { NOTIFICATION_SENDER_UPDATE_ACTION } from '../../../common-lib/admin/audit-actions/notifications.ts';
import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import type { SenderInfo } from '../../../lib/core/email/ports.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type {
  SenderInfoRecord,
  SenderInfoStore,
} from '../../../lib/core/notifications/ports.ts';
import { NOTIFICATIONS_ERRORS } from './notifications-errors.ts';
import { NOTIFICATIONS_TYPES } from './notifications-types.ts';
import type { SenderInfoSave, SenderInfoWriter } from './ports.ts';
import {
  type SenderInfoService,
  StoreSenderInfoService,
} from './sender-info-service.ts';

const SETTING_ID = '01M7BNN5000000000000000001';

const ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';

const PREVIOUS_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRV';

const AUDIT_LOG_ID = '01JD0000000000000000AUDIT1';

const SEEDED_AT = new Date('2026-11-14T00:00:00.000Z');

const UPDATED_AT = new Date('2026-11-18T00:00:00.000Z');

const NOW = new Date('2026-11-20T03:00:00.000Z');

const INFO: SenderInfo = {
  businessName: 'ローンチ運営',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都千代田区1-2-3',
};

const SEED_RECORD: SenderInfoRecord = {
  settingId: SETTING_ID,
  version: 0,
  info: undefined,
  updatedAt: SEEDED_AT,
  updatedByAdminId: null,
};

const SAVED_RECORD: SenderInfoRecord = {
  settingId: SETTING_ID,
  version: 3,
  info: INFO,
  updatedAt: UPDATED_AT,
  updatedByAdminId: PREVIOUS_ADMIN_ID,
};

interface FakeOptions {
  readonly records?: readonly (SenderInfoRecord | undefined)[];
  readonly saveResult?: 'saved' | 'version_conflict';
  readonly saveError?: Error;
  readonly prepareError?: Error;
}

// 読み取りは呼ばれるたびに次の行を返し、保存の後の読み直しを再現する
function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const prepared: AuditEntryInput[] = [];
  const saves: SenderInfoSave[] = [];
  const records = [...(options.records ?? [SEED_RECORD])];
  const store: SenderInfoStore = {
    get: () => {
      calls.push('get');
      const next = records.length > 1 ? records.shift() : records[0];
      return Promise.resolve(next);
    },
  };
  const writer: SenderInfoWriter = {
    save: (input) => {
      calls.push('save');
      saves.push(input);
      return options.saveError === undefined
        ? Promise.resolve(options.saveResult ?? 'saved')
        : Promise.reject(options.saveError);
    },
  };
  const auditLog: AuditLogRecorder = {
    prepare: (entry) => {
      calls.push('prepare');
      prepared.push(entry);
      if (options.prepareError !== undefined) {
        throw options.prepareError;
      }
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
  return {
    calls,
    prepared,
    saves,
    store,
    writer,
    auditLog,
    service: new StoreSenderInfoService(store, writer, auditLog),
  };
}

function updateOf(
  info: SenderInfo,
  overrides: {
    readonly expectedVersion?: number;
    readonly reason?: string;
  } = {},
) {
  return {
    adminId: ADMIN_ID,
    info,
    expectedVersion: overrides.expectedVersion ?? 0,
    reason: overrides.reason,
    now: NOW,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否される想定です');
}

describe('StoreSenderInfoService', () => {
  describe('read', () => {
    test('版0のシードの行は未設定として、値・最後に変更した日時・変更した管理者をnullで返す', async () => {
      const { service } = setup();

      expect(await service.read()).toEqual({
        info: null,
        version: 0,
        updatedAt: null,
        updatedByAdminId: null,
      });
    });

    test('保存済みの行は値・版・最後に変更した日時・変更した管理者のIDを返す', async () => {
      const { service } = setup({ records: [SAVED_RECORD] });

      expect(await service.read()).toEqual({
        info: INFO,
        version: 3,
        updatedAt: UPDATED_AT,
        updatedByAdminId: PREVIOUS_ADMIN_ID,
      });
    });

    test('シードの行が無ければ未設定の版0として返す', async () => {
      const { service } = setup({ records: [undefined] });

      expect(await service.read()).toEqual({
        info: null,
        version: 0,
        updatedAt: null,
        updatedByAdminId: null,
      });
    });
  });

  describe('updateの検証', () => {
    test.each([
      ['businessName', { ...INFO, businessName: '' }],
      ['contactEmail', { ...INFO, contactEmail: '' }],
      ['postalAddress', { ...INFO, postalAddress: '' }],
    ] as const)(
      '%sが空ならemptyの違反を返し、監査ログの準備も保存もしない',
      async (field, info) => {
        const { service, calls } = setup();

        expect(await service.update(updateOf(info))).toEqual({
          kind: 'invalid',
          violations: [{ field, reason: 'empty' }],
        });
        expect(calls).toEqual([]);
      },
    );

    test('前後の空白だけの項目は空として扱う', async () => {
      const { service } = setup();

      expect(
        await service.update(updateOf({ ...INFO, postalAddress: ' 　\n' })),
      ).toEqual({
        kind: 'invalid',
        violations: [{ field: 'postalAddress', reason: 'empty' }],
      });
    });

    test('200書記素までは受け付け、201書記素はtoo-longの違反を返す', async () => {
      const { service, saves } = setup({ records: [SEED_RECORD] });

      expect(
        await service.update(
          updateOf({ ...INFO, businessName: '👨‍👩‍👧'.repeat(201) }),
        ),
      ).toEqual({
        kind: 'invalid',
        violations: [{ field: 'businessName', reason: 'too-long' }],
      });
      expect(
        await service.update(
          updateOf({ ...INFO, businessName: '👨‍👩‍👧'.repeat(200) }),
        ),
      ).toMatchObject({ kind: 'saved' });
      expect(saves).toHaveLength(1);
    });

    test('連絡先メールアドレスの形式が正しくなければinvalid-emailの違反を返す', async () => {
      const { service, calls } = setup();

      expect(
        await service.update(updateOf({ ...INFO, contactEmail: 'support@' })),
      ).toEqual({
        kind: 'invalid',
        violations: [{ field: 'contactEmail', reason: 'invalid-email' }],
      });
      expect(calls).toEqual([]);
    });

    test('連絡先メールアドレスは前後の空白を除いた値で形式を判定する', async () => {
      const { service, saves } = setup();

      await service.update(
        updateOf({ ...INFO, contactEmail: '  support@launch.example\t' }),
      );

      expect(saves[0]?.info.contactEmail).toBe('support@launch.example');
    });

    test('連絡先メールアドレスが200書記素を超える場合は形式ではなく超過の違反だけを返す', async () => {
      const { service } = setup();

      expect(
        await service.update(
          updateOf({ ...INFO, contactEmail: `${'a'.repeat(200)}@` }),
        ),
      ).toEqual({
        kind: 'invalid',
        violations: [{ field: 'contactEmail', reason: 'too-long' }],
      });
    });

    test('複数の項目の違反を項目の順に1つずつ返す', async () => {
      const { service } = setup();

      expect(
        await service.update(
          updateOf({
            businessName: 'あ'.repeat(201),
            contactEmail: 'support',
            postalAddress: '',
          }),
        ),
      ).toEqual({
        kind: 'invalid',
        violations: [
          { field: 'businessName', reason: 'too-long' },
          { field: 'contactEmail', reason: 'invalid-email' },
          { field: 'postalAddress', reason: 'empty' },
        ],
      });
    });
  });

  describe('updateの保存', () => {
    test('前後の空白を除いた値を、読み取った版・操作した管理者・準備した監査ログ・日時とともに保存し、読み直した最新の状態を返す', async () => {
      const { service, calls, saves } = setup({
        records: [
          SEED_RECORD,
          {
            ...SAVED_RECORD,
            version: 1,
            updatedAt: NOW,
            updatedByAdminId: ADMIN_ID,
          },
        ],
      });

      const result = await service.update(
        updateOf({
          businessName: '  ローンチ運営 ',
          contactEmail: '　support@launch.example',
          postalAddress: '東京都千代田区1-2-3\n',
        }),
      );

      expect(calls).toEqual(['get', 'prepare', 'save', 'get']);
      expect(saves).toHaveLength(1);
      expect(saves[0]).toMatchObject({
        info: INFO,
        expectedVersion: 0,
        adminId: ADMIN_ID,
        at: NOW,
      });
      expect(saves[0]?.audit.id).toBe(AUDIT_LOG_ID);
      expect(result).toEqual({
        kind: 'saved',
        view: {
          info: INFO,
          version: 1,
          updatedAt: NOW,
          updatedByAdminId: ADMIN_ID,
        },
      });
    });

    test('監査ログは操作種別・シードの固定のIDの対象・理由・日時と、未設定からの保存で3項目の名前だけを詳細に準備する', async () => {
      const { service, prepared } = setup();

      await service.update(updateOf(INFO, { reason: '運営会社の移転' }));

      expect(prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action: NOTIFICATION_SENDER_UPDATE_ACTION.name,
          targetIds: [SETTING_ID],
          reason: '運営会社の移転',
          detail: { fields: 'businessName,contactEmail,postalAddress' },
          occurredAt: NOW,
        },
      ]);
    });

    test('監査ログの詳細には変更した項目の名前だけを入れ、送信者情報の値を含めない', async () => {
      const { service, prepared } = setup({ records: [SAVED_RECORD] });

      await service.update(
        updateOf(
          { ...INFO, contactEmail: 'help@launch.example' },
          { expectedVersion: 3 },
        ),
      );

      expect(prepared[0]?.detail).toEqual({ fields: 'contactEmail' });
      const serialized = JSON.stringify(prepared[0]);
      for (const value of [
        INFO.businessName,
        INFO.postalAddress,
        INFO.contactEmail,
        'help@launch.example',
      ]) {
        expect(serialized).not.toContain(value);
      }
    });

    test('前後の空白だけが異なる項目は変更した項目に数えない', async () => {
      const { service, prepared } = setup({ records: [SAVED_RECORD] });

      await service.update(
        updateOf(
          {
            businessName: ` ${INFO.businessName} `,
            contactEmail: INFO.contactEmail,
            postalAddress: '大阪府大阪市4-5-6',
          },
          { expectedVersion: 3 },
        ),
      );

      expect(prepared[0]?.detail).toEqual({ fields: 'postalAddress' });
    });

    test('値が1つも変わらない保存も版を進めて記録し、詳細の項目の名前は空にする', async () => {
      const { service, prepared, saves } = setup({ records: [SAVED_RECORD] });

      await service.update(updateOf(INFO, { expectedVersion: 3 }));

      expect(prepared[0]?.detail).toEqual({ fields: '' });
      expect(saves).toHaveLength(1);
    });

    test('理由を省略すると監査ログの準備に理由を渡さない', async () => {
      const { service, prepared } = setup();

      await service.update(updateOf(INFO));

      expect(prepared[0]).not.toHaveProperty('reason');
    });

    test('監査ログの準備が違反で失敗すれば保存しない', async () => {
      const failure = new AppError({
        kind: 'bad_request',
        code: 'validation_error',
        message: '入力内容を確認してください。',
      });
      const { service, calls } = setup({ prepareError: failure });

      expect(await rejectionOf(service.update(updateOf(INFO)))).toBe(failure);
      expect(calls).toEqual(['get', 'prepare']);
    });

    test('版が一致しなければversion_conflictのAppErrorで拒否し、読み直さない', async () => {
      const { service, calls } = setup({ saveResult: 'version_conflict' });

      const error = await rejectionOf(service.update(updateOf(INFO)));

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'conflict',
        code: 'version_conflict',
        message: NOTIFICATIONS_ERRORS.version_conflict.message,
      });
      expect(calls).toEqual(['get', 'prepare', 'save']);
    });

    test('保存のその他の失敗はそのまま投げる', async () => {
      const failure = new Error('D1の障害');
      const { service } = setup({ saveError: failure });

      expect(await rejectionOf(service.update(updateOf(INFO)))).toBe(failure);
    });

    test('シードの行が無ければ監査ログを準備せずに失敗する', async () => {
      const { service, calls } = setup({ records: [undefined] });

      const error = await rejectionOf(service.update(updateOf(INFO)));

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AppError);
      expect(calls).toEqual(['get']);
    });
  });
});

describe('StoreSenderInfoServiceの注入', () => {
  test('送信者情報のストアと保存・監査ログの記録を識別子で注入して解決できる', async () => {
    const { store, writer, auditLog } = setup();
    const container = new Container();
    container
      .bind<SenderInfoStore>(NOTIFICATIONS_PLATFORM_TYPES.SenderInfoStore)
      .toConstantValue(store);
    container
      .bind<SenderInfoWriter>(NOTIFICATIONS_TYPES.SenderInfoWriter)
      .toConstantValue(writer);
    container
      .bind<AuditLogRecorder>(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
      .toConstantValue(auditLog);
    container
      .bind<SenderInfoService>(NOTIFICATIONS_TYPES.SenderInfoService)
      .to(StoreSenderInfoService);

    const service = container.get<SenderInfoService>(
      NOTIFICATIONS_TYPES.SenderInfoService,
    );

    expect(service).toBeInstanceOf(StoreSenderInfoService);
    expect(await service.read()).toMatchObject({ version: 0 });
  });
});
