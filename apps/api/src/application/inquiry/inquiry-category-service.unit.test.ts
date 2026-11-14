import { describe, expect, test } from 'bun:test';

import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { StoreInquiryCategoryService } from './inquiry-category-service.ts';
import type { InquiryCategoryRecord, InquiryCategoryStore } from './ports.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');
const NEW_CATEGORY_ID = '01JD00000000000000000NEW01';
const OTHER_ID = '01JC0000000000000000000000';
const BUG_ID = '01JD0000000000000000000BUG';
const BILLING_ID = '01JD00000000000000000BILL1';

const CURRENT: CurrentAdmin = Object.freeze({
  id: '01JBX8Y4Z5ABCDEFGHJKMNPQRS',
  role: 'moderator',
  nickname: '運営の管理者',
  sessionId: 'session-1',
});

const OTHER: InquiryCategoryRecord = Object.freeze({
  id: OTHER_ID,
  name: 'その他',
  systemDefault: true,
  createdAt: new Date('2024-11-06T05:43:40.288Z'),
});

const BUG: InquiryCategoryRecord = Object.freeze({
  id: BUG_ID,
  name: '不具合の報告',
  systemDefault: false,
  createdAt: new Date('2027-01-01T00:00:00.000Z'),
});

const BILLING: InquiryCategoryRecord = Object.freeze({
  id: BILLING_ID,
  name: '料金について',
  systemDefault: false,
  createdAt: new Date('2027-02-01T00:00:00.000Z'),
});

const fixedClock: Clock = { now: () => new Date(NOW) };

const fixedIds: IdGenerator = { generate: () => NEW_CATEGORY_ID };

interface FakeOptions {
  readonly categories?: readonly InquiryCategoryRecord[];
  readonly linkedCounts?: ReadonlyMap<string, number>;
  readonly insertResult?: 'created' | 'name-taken';
  readonly renameResult?: 'renamed' | 'name-taken' | 'not-found';
  readonly deleteResult?: {
    readonly result: 'deleted' | 'not-found';
    readonly reassigned: number;
  };
  readonly prepareError?: AppError;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const prepared: AuditEntryInput[] = [];
  const preparedEntries: PreparedAuditEntry[] = [];
  const categories = options.categories ?? [BILLING, OTHER, BUG];
  const linkedCounts = options.linkedCounts ?? new Map<string, number>();
  const writes: {
    readonly method: string;
    readonly args: readonly unknown[];
  }[] = [];
  const store: InquiryCategoryStore = {
    list: () => {
      calls.push('list');
      return Promise.resolve(categories);
    },
    findById: (id) => {
      calls.push('findById');
      return Promise.resolve(categories.find((category) => category.id === id));
    },
    insert: (category, audit) => {
      calls.push('insert');
      writes.push({ method: 'insert', args: [category, audit] });
      return Promise.resolve(options.insertResult ?? 'created');
    },
    rename: (id, name, at, audit) => {
      calls.push('rename');
      writes.push({ method: 'rename', args: [id, name, at, audit] });
      return Promise.resolve(options.renameResult ?? 'renamed');
    },
    deleteAndReassign: (id, audit) => {
      calls.push('deleteAndReassign');
      writes.push({ method: 'deleteAndReassign', args: [id, audit] });
      return Promise.resolve(
        options.deleteResult ?? {
          result: 'deleted',
          reassigned: linkedCounts.get(id) ?? 0,
        },
      );
    },
    countLinked: (id) => {
      calls.push('countLinked');
      return Promise.resolve(linkedCounts.get(id) ?? 0);
    },
    countLinkedByCategory: () => {
      calls.push('countLinkedByCategory');
      return Promise.resolve(linkedCounts);
    },
  };
  // 準備済みの記録は記録の実装だけが作れるため、偽物は型の表明で作る。記録の検証そのものは監査ログのテストが確かめる
  const auditLog: AuditLogRecorder = {
    prepare: (entry) => {
      calls.push('prepare');
      prepared.push(entry);
      if (options.prepareError !== undefined) {
        throw options.prepareError;
      }
      const entryOf = Object.freeze({
        id: `audit-${String(prepared.length)}`,
        operatorAdminId: entry.operatorAdminId,
        action: entry.action,
        targetKind: 'category',
        targetIds: entry.targetIds,
        reason: entry.reason ?? null,
        detail: entry.detail ?? {},
        occurredAt: entry.occurredAt,
      }) as PreparedAuditEntry;
      preparedEntries.push(entryOf);
      return entryOf;
    },
    record: () => Promise.reject(new Error('単独の記録は呼ばれない想定です')),
  };
  const service = new StoreInquiryCategoryService(
    store,
    auditLog,
    fixedIds,
    fixedClock,
  );
  return { service, calls, prepared, preparedEntries, writes };
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) {
    throw new Error('AppErrorで拒否される想定です', { cause: error });
  }
  return error;
}

const summaryOf = (error: AppError) => ({
  kind: error.kind,
  code: error.code,
  details: error.details,
});

const PREPARE_REJECTION = new AppError({
  kind: 'bad_request',
  code: 'validation_error',
  message: '入力内容を確認してください。',
});

const NAME_VIOLATIONS = [
  [
    '使用できない文字を含む',
    'お問い合わせ\u0001',
    'forbidden-character',
    'カテゴリ名に使用できない文字が含まれています。',
  ],
  ['空白だけの', ' 　 ', 'empty', 'カテゴリ名を入力してください。'],
  [
    '30書記素を超える',
    'あ'.repeat(31),
    'too-long',
    'カテゴリ名は30文字以内で入力してください。',
  ],
] as const;

describe('StoreInquiryCategoryService.list', () => {
  test('追加の順に並べ、標準カテゴリを末尾に置く', async () => {
    const { service } = setup();

    const categories = await service.list();

    expect(categories.map((category) => category.id)).toEqual([
      BUG_ID,
      BILLING_ID,
      OTHER_ID,
    ]);
  });

  test('紐付く件数を数えない', async () => {
    const { service, calls } = setup();

    await service.list();

    expect(calls).toEqual(['list']);
  });
});

describe('StoreInquiryCategoryService.listForAdmin', () => {
  test('一覧と同じ並びで、カテゴリごとの紐付く件数を付ける', async () => {
    const { service } = setup({
      linkedCounts: new Map([
        [BUG_ID, 4],
        [OTHER_ID, 12],
      ]),
    });

    const categories = await service.listForAdmin();

    expect(categories).toEqual([
      { ...BUG, linkedCount: 4 },
      { ...BILLING, linkedCount: 0 },
      { ...OTHER, linkedCount: 12 },
    ]);
  });
});

describe('StoreInquiryCategoryService.create', () => {
  test('前後の空白を除いた名前で、監査ログを準備してから保存する', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup();

    const created = await service.create(CURRENT, {
      name: '  機能の要望 ',
      reason: '要望の窓口を分ける',
    });

    expect(created).toEqual({
      id: NEW_CATEGORY_ID,
      name: '機能の要望',
      systemDefault: false,
      createdAt: NOW,
    });
    expect(calls).toEqual(['prepare', 'insert']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'inquiry-category.create',
        targetIds: [NEW_CATEGORY_ID],
        reason: '要望の窓口を分ける',
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'insert',
        args: [
          { id: NEW_CATEGORY_ID, name: '機能の要望', at: NOW },
          preparedEntries[0],
        ],
      },
    ]);
    expect(writes[0]?.args[1]).toBe(preparedEntries[0]);
  });

  test('理由が無ければ監査ログの入力に理由を含めない', async () => {
    const { service, prepared } = setup();

    await service.create(CURRENT, { name: '機能の要望' });

    expect(prepared[0]).not.toHaveProperty('reason');
  });

  test('監査ログにカテゴリ名を含めない', async () => {
    const { service, prepared } = setup();

    await service.create(CURRENT, { name: '機能の要望' });

    expect(JSON.stringify(prepared)).not.toContain('機能の要望');
  });

  test.each(NAME_VIOLATIONS)(
    '%s名前を、監査ログの準備と保存の前に検証のエラーで拒否する',
    async (_, name, code, message) => {
      const { service, calls } = setup();

      const error = await rejectionOf(service.create(CURRENT, { name }));

      expect(summaryOf(error)).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        details: [{ field: 'name', code, message }],
      });
      expect(calls).toEqual([]);
    },
  );

  test('大文字小文字を区別しない重複をストアが返すと名前の重複のエラーにする', async () => {
    const { service } = setup({ insertResult: 'name-taken' });

    const error = await rejectionOf(service.create(CURRENT, { name: 'faq' }));

    expect(summaryOf(error)).toEqual({
      kind: 'conflict',
      code: 'inquiry_category_name_taken',
      details: [
        {
          field: 'name',
          code: 'name-taken',
          message: '同じ名前のカテゴリが既にあります。',
        },
      ],
    });
  });

  test('監査ログの準備が拒否すると保存しない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(
      service.create(CURRENT, { name: '機能の要望', reason: 'x' }),
    );

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['prepare']);
  });
});

describe('StoreInquiryCategoryService.rename', () => {
  test('対象を確かめ、監査ログを準備してから前後の空白を除いた名前で変更する', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup();

    const renamed = await service.rename(CURRENT, {
      id: BUG_ID,
      name: ' 不具合・障害の報告 ',
      reason: '名前を分かりやすくする',
    });

    expect(renamed).toEqual({ ...BUG, name: '不具合・障害の報告' });
    expect(calls).toEqual(['findById', 'prepare', 'rename']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'inquiry-category.rename',
        targetIds: [BUG_ID],
        reason: '名前を分かりやすくする',
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'rename',
        args: [BUG_ID, '不具合・障害の報告', NOW, preparedEntries[0]],
      },
    ]);
    expect(writes[0]?.args[3]).toBe(preparedEntries[0]);
  });

  test('標準カテゴリの名前の変更を、監査ログの準備の前に拒否する', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.rename(CURRENT, { id: OTHER_ID, name: 'そのほか' }),
    );

    expect(summaryOf(error)).toEqual({
      kind: 'conflict',
      code: 'inquiry_category_protected',
      details: undefined,
    });
    expect(calls).toEqual(['findById']);
  });

  test('存在しないカテゴリをカテゴリの不在のエラーにする', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.rename(CURRENT, { id: NEW_CATEGORY_ID, name: '機能の要望' }),
    );

    expect(summaryOf(error)).toEqual({
      kind: 'not_found',
      code: 'inquiry_category_not_found',
      details: undefined,
    });
    expect(calls).toEqual(['findById']);
  });

  test.each(NAME_VIOLATIONS)(
    '%s名前を、対象の確認の前に検証のエラーで拒否する',
    async (_, name, code, message) => {
      const { service, calls } = setup();

      const error = await rejectionOf(
        service.rename(CURRENT, { id: BUG_ID, name }),
      );

      expect(summaryOf(error)).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        details: [{ field: 'name', code, message }],
      });
      expect(calls).toEqual([]);
    },
  );

  test.each([
    ['name-taken', 'conflict', 'inquiry_category_name_taken'],
    ['not-found', 'not_found', 'inquiry_category_not_found'],
  ] as const)(
    'ストアが%sを返すと%sの種類のエラーにする',
    async (renameResult, kind, code) => {
      const { service } = setup({ renameResult });

      const error = await rejectionOf(
        service.rename(CURRENT, { id: BUG_ID, name: '料金について' }),
      );

      expect({ kind: error.kind, code: error.code }).toEqual({ kind, code });
    },
  );

  test('監査ログの準備が拒否すると変更しない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(
      service.rename(CURRENT, { id: BUG_ID, name: '障害の報告' }),
    );

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['findById', 'prepare']);
  });
});

describe('StoreInquiryCategoryService.delete', () => {
  test('付け替えの件数を監査ログの詳細に入れて準備してから、削除と付け替えを行う', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup({
      linkedCounts: new Map([[BUG_ID, 3]]),
    });

    const result = await service.delete(CURRENT, {
      id: BUG_ID,
      reason: '使われなくなった',
    });

    expect(result).toEqual({ reassignedCount: 3 });
    expect(calls).toEqual([
      'findById',
      'countLinked',
      'prepare',
      'deleteAndReassign',
    ]);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'inquiry-category.delete',
        targetIds: [BUG_ID],
        reason: '使われなくなった',
        detail: { reassignedCount: '3' },
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      { method: 'deleteAndReassign', args: [BUG_ID, preparedEntries[0]] },
    ]);
    expect(writes[0]?.args[1]).toBe(preparedEntries[0]);
  });

  test('紐付く問い合わせが無ければ付け替えの件数を0として記録する', async () => {
    const { service, prepared } = setup();

    const result = await service.delete(CURRENT, { id: BILLING_ID });

    expect(result).toEqual({ reassignedCount: 0 });
    expect(prepared[0]?.detail).toEqual({ reassignedCount: '0' });
    expect(prepared[0]).not.toHaveProperty('reason');
  });

  test('返す件数は実際に付け替えた件数にする', async () => {
    const { service, prepared } = setup({
      linkedCounts: new Map([[BUG_ID, 3]]),
      deleteResult: { result: 'deleted', reassigned: 4 },
    });

    const result = await service.delete(CURRENT, { id: BUG_ID });

    expect(result).toEqual({ reassignedCount: 4 });
    expect(prepared[0]?.detail).toEqual({ reassignedCount: '3' });
  });

  test('標準カテゴリの削除を、件数の照会と監査ログの準備の前に拒否する', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(service.delete(CURRENT, { id: OTHER_ID }));

    expect(summaryOf(error)).toEqual({
      kind: 'conflict',
      code: 'inquiry_category_protected',
      details: undefined,
    });
    expect(calls).toEqual(['findById']);
  });

  test('存在しないカテゴリをカテゴリの不在のエラーにする', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.delete(CURRENT, { id: NEW_CATEGORY_ID }),
    );

    expect(error.code).toBe('inquiry_category_not_found');
    expect(calls).toEqual(['findById']);
  });

  test('削除の時点で消えていればカテゴリの不在のエラーにする', async () => {
    const { service } = setup({
      deleteResult: { result: 'not-found', reassigned: 0 },
    });

    const error = await rejectionOf(service.delete(CURRENT, { id: BUG_ID }));

    expect(error.code).toBe('inquiry_category_not_found');
  });

  test('監査ログの準備が拒否すると削除しない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(service.delete(CURRENT, { id: BUG_ID }));

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['findById', 'countLinked', 'prepare']);
  });
});
