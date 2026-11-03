import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { Container } from 'inversify';

import { AUDIT_REASON_MAX } from '../../../common-lib/admin/admin-input-rules.ts';
import {
  type AuditActionCatalog,
  createAuditActionCatalog,
  defineAuditAction,
} from '../../../common-lib/admin/audit-action.ts';
import { AUDIT_ACTIONS } from '../../../common-lib/admin/audit-actions/index.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { AuditEntryInput } from '../../domain/admin/audit-entry.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import {
  type AuditLogRecorder,
  type PreparedAuditEntry,
  StoreAuditLogRecorder,
} from './audit-log-recorder.ts';
import type { AuditLogStore } from './ports.ts';

const OPERATOR_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';

const TARGET_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRT';

const OTHER_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRV';

const USER_IDS = [
  '0b5f8c3e-2d4a-4f6b-9c1e-7a8d9e0f1a2b',
  '1c6a9d4f-3e5b-4a7c-8d2f-8b9e0f1a2b3c',
] as const;

const OCCURRED_AT = new Date('2026-11-03T12:00:00.000Z');

const REASON_REQUIRED_ACTION = defineAuditAction({
  name: 'product.suspend',
  label: '製品の公開停止',
  targetKind: 'product',
  reason: 'required',
  detailKeys: [],
  maxTargets: 3,
});

const TARGETLESS_ACTION = defineAuditAction({
  name: 'setting.export',
  label: '設定の書き出し',
  targetKind: null,
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

const CATALOG = createAuditActionCatalog([
  ...AUDIT_ACTIONS,
  REASON_REQUIRED_ACTION,
  TARGETLESS_ACTION,
]);

const inviteEntry = (
  overrides: Partial<AuditEntryInput> = {},
): AuditEntryInput => ({
  operatorAdminId: OPERATOR_ADMIN_ID,
  action: 'admin-account.invite',
  targetIds: [TARGET_ADMIN_ID],
  occurredAt: OCCURRED_AT,
  ...overrides,
});

interface Recorded {
  readonly inserted: PreparedAuditEntry[];
  readonly generatedIds: string[];
}

interface FakeOptions {
  readonly insertError?: Error;
}

function setup(options: FakeOptions = {}) {
  const recorded: Recorded = { inserted: [], generatedIds: [] };
  const ids: IdGenerator = {
    generate: () => {
      const id = `01JAUDITLOG000000000000${String(recorded.generatedIds.length + 1).padStart(3, '0')}`;
      recorded.generatedIds.push(id);
      return id;
    },
  };
  const store: AuditLogStore = {
    insert: (entry) => {
      if (options.insertError !== undefined) {
        return Promise.reject(options.insertError);
      }
      recorded.inserted.push(entry);
      return Promise.resolve();
    },
    search: () => Promise.reject(new Error('検索は呼ばれない想定です')),
    latestFor: () => Promise.reject(new Error('照会は呼ばれない想定です')),
    latestForMany: () => Promise.reject(new Error('照会は呼ばれない想定です')),
    deleteOccurredUntil: () =>
      Promise.reject(new Error('削除は呼ばれない想定です')),
  };
  const recorder = new StoreAuditLogRecorder(CATALOG, ids, store);
  return { recorder, recorded, ids, store };
}

function catchError(action: () => unknown): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

async function catchAsyncError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

describe('StoreAuditLogRecorder.prepare', () => {
  test('採番したID・操作者・操作種別・対象の種類とID・理由・詳細・日時を持つ値を作り、保存しない', () => {
    const { recorder, recorded } = setup();

    const prepared = recorder.prepare(
      inviteEntry({
        action: 'admin-account.role-change',
        reason: '  担当の変更  ',
        detail: { fromRole: 'viewer', toRole: 'moderator' },
      }),
    );

    expect(prepared.id).toBe('01JAUDITLOG000000000000001');
    expect(prepared.operatorAdminId).toBe(OPERATOR_ADMIN_ID);
    expect(prepared.action).toBe('admin-account.role-change');
    expect(prepared.targetKind).toBe('admin');
    expect(prepared.targetIds).toEqual([TARGET_ADMIN_ID]);
    expect(prepared.reason).toBe('担当の変更');
    expect(prepared.detail).toEqual({
      fromRole: 'viewer',
      toRole: 'moderator',
    });
    expect(prepared.occurredAt).toEqual(OCCURRED_AT);
    expect(recorded.inserted).toHaveLength(0);
  });

  test('空白だけの任意の理由と省略した詳細は、理由なし・空の詳細として準備する', () => {
    const { recorder } = setup();

    const prepared = recorder.prepare(inviteEntry({ reason: ' 　 ' }));

    expect(prepared.reason).toBeNull();
    expect(prepared.detail).toEqual({});
  });

  test('重複した対象のIDは最初の出現の順に1つにまとめる', () => {
    const { recorder } = setup();

    const prepared = recorder.prepare({
      operatorAdminId: OPERATOR_ADMIN_ID,
      action: 'user.email-search',
      targetIds: [USER_IDS[0], USER_IDS[1], USER_IDS[0]],
      occurredAt: OCCURRED_AT,
    });

    expect(prepared.targetKind).toBe('user');
    expect(prepared.targetIds).toEqual([USER_IDS[0], USER_IDS[1]]);
  });

  test('重複を除いた件数が上限以内なら、上限を超える数の重複したIDを受け付ける', () => {
    const { recorder } = setup();

    const prepared = recorder.prepare(
      inviteEntry({ targetIds: [TARGET_ADMIN_ID, TARGET_ADMIN_ID] }),
    );

    expect(prepared.targetIds).toEqual([TARGET_ADMIN_ID]);
  });

  test('対象が0件なら対象の種類を持たない記録として準備する', () => {
    const { recorder } = setup();

    const prepared = recorder.prepare({
      operatorAdminId: OPERATOR_ADMIN_ID,
      action: 'user.email-search',
      targetIds: [],
      occurredAt: OCCURRED_AT,
    });

    expect(prepared.targetKind).toBeNull();
    expect(prepared.targetIds).toEqual([]);
  });

  test('準備した値は書き換えられず、呼び出し側の配列と詳細の変更に影響されない', () => {
    const { recorder } = setup();
    const targetIds = [TARGET_ADMIN_ID];
    const detail: Record<string, string> = {
      fromRole: 'viewer',
      toRole: 'moderator',
    };

    const prepared = recorder.prepare(
      inviteEntry({ action: 'admin-account.role-change', targetIds, detail }),
    );
    targetIds.push(OTHER_ADMIN_ID);
    detail['toRole'] = 'super_admin';

    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.targetIds)).toBe(true);
    expect(Object.isFrozen(prepared.detail)).toBe(true);
    expect(prepared.targetIds).toEqual([TARGET_ADMIN_ID]);
    expect(prepared.detail).toEqual({
      fromRole: 'viewer',
      toRole: 'moderator',
    });
  });

  test('呼び出しごとに別のIDを採番する', () => {
    const { recorder } = setup();

    const first = recorder.prepare(inviteEntry());
    const second = recorder.prepare(inviteEntry());

    expect(first.id).not.toBe(second.id);
  });

  test.each([
    {
      title: '未登録の操作種別',
      input: inviteEntry({ action: 'product.unknown' }),
      field: 'action',
      code: 'unknown_action',
      message: '操作種別が登録されていません。',
    },
    {
      title: '理由が必須で空',
      input: inviteEntry({
        action: 'product.suspend',
        targetIds: ['product-1'],
        reason: '  ',
      }),
      field: 'reason',
      code: 'reason_required',
      message: '理由を入力してください。',
    },
    {
      title: '理由を受け付けない種別に理由がある',
      input: inviteEntry({
        action: 'user.email-search',
        targetIds: [],
        reason: 'example.example',
      }),
      field: 'reason',
      code: 'reason_not_allowed',
      message: 'この操作には理由を入力できません。',
    },
    {
      title: '理由が上限を超える',
      input: inviteEntry({ reason: 'あ'.repeat(AUDIT_REASON_MAX + 1) }),
      field: 'reason',
      code: 'reason_too_long',
      message: `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`,
    },
    {
      title: 'ユーザーの対象が仮名化IDの形式でない',
      input: inviteEntry({
        action: 'user.email-search',
        targetIds: ['someone@mail.example'],
      }),
      field: 'targets',
      code: 'invalid_target',
      message: '対象の識別子の形式が正しくありません。',
    },
    {
      title: '重複を除いた対象が上限を超える',
      input: inviteEntry({ targetIds: [TARGET_ADMIN_ID, OTHER_ADMIN_ID] }),
      field: 'targets',
      code: 'too_many_targets',
      message: '対象の件数が上限を超えています。',
    },
    {
      title: '対象を取らない種別に対象がある',
      input: inviteEntry({ action: 'setting.export' }),
      field: 'targets',
      code: 'targets_not_allowed',
      message: 'この操作には対象を指定できません。',
    },
    {
      title: '登録外の詳細の鍵',
      input: inviteEntry({ detail: { query: 'someone@mail.example' } }),
      field: 'detail',
      code: 'invalid_detail',
      message: '詳細の内容が正しくありません。',
    },
  ])(
    '$titleなら欄ごとの詳細を持つ検証のエラーになり、IDを採番しない',
    ({ input, field, code, message }) => {
      const { recorder, recorded } = setup();

      const error = catchError(() => recorder.prepare(input));

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'bad_request',
        code: 'validation_error',
        message: '入力内容を確認してください。',
        details: [{ field, code, message }],
      });
      expect(recorded.generatedIds).toHaveLength(0);
      expect(recorded.inserted).toHaveLength(0);
    },
  );

  test('検証の違反を操作種別と違反の種類だけのwarningのログに残す', () => {
    const { recorder } = setup();
    const reason = 'あ'.repeat(AUDIT_REASON_MAX + 1);

    catchError(() => recorder.prepare(inviteEntry({ reason })));

    const warnings = records.filter(
      (record) =>
        record.category.join('.') === 'api.admin.audit-log' &&
        record.level === 'warning',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.properties).toEqual({
      action: 'admin-account.invite',
      violation: 'reason_too_long',
    });
    expect(JSON.stringify(warnings[0]?.properties)).not.toContain(reason);
  });
});

describe('StoreAuditLogRecorder.record', () => {
  test('準備した値を単独でストアへ保存する', async () => {
    const { recorder, recorded } = setup();

    await recorder.record({
      operatorAdminId: OPERATOR_ADMIN_ID,
      action: 'user.email-search',
      targetIds: [USER_IDS[0]],
      occurredAt: OCCURRED_AT,
    });

    expect(recorded.inserted).toHaveLength(1);
    expect(recorded.inserted[0]).toMatchObject({
      id: '01JAUDITLOG000000000000001',
      operatorAdminId: OPERATOR_ADMIN_ID,
      action: 'user.email-search',
      targetKind: 'user',
      targetIds: [USER_IDS[0]],
      reason: null,
      detail: {},
      occurredAt: OCCURRED_AT,
    });
  });

  test('違反のある入力は検証のエラーになり、何も保存しない', async () => {
    const { recorder, recorded } = setup();

    const error = await catchAsyncError(
      recorder.record(
        inviteEntry({ action: 'user.email-search', targetIds: ['not-a-uuid'] }),
      ),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'validation_error',
      details: [{ field: 'targets', code: 'invalid_target' }],
    });
    expect(recorded.inserted).toHaveLength(0);
  });

  test('保存の失敗はそのまま呼び出し側へ伝える', async () => {
    const failure = new Error('保存に失敗しました');
    const { recorder } = setup({ insertError: failure });

    expect(await catchAsyncError(recorder.record(inviteEntry()))).toBe(failure);
  });
});

describe('StoreAuditLogRecorder', () => {
  test('コンテナで依存を注入して解決できる', () => {
    const { ids, store } = setup();
    const container = new Container();
    container
      .bind<AuditActionCatalog>(ADMIN_TYPES.AuditActionCatalog)
      .toConstantValue(CATALOG);
    container
      .bind<IdGenerator>(PLATFORM_TYPES.IdGenerator)
      .toConstantValue(ids);
    container
      .bind<AuditLogStore>(ADMIN_TYPES.AuditLogStore)
      .toConstantValue(store);
    container
      .bind<AuditLogRecorder>(ADMIN_TYPES.AuditLogRecorder)
      .to(StoreAuditLogRecorder);

    const recorder = container.get<AuditLogRecorder>(
      ADMIN_TYPES.AuditLogRecorder,
    );

    expect(recorder.prepare(inviteEntry()).action).toBe('admin-account.invite');
  });
});
