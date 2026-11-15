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
import { StoreHelpCategoryService } from './help-category-service.ts';
import type {
  HelpCategoryRecord,
  HelpCategoryStore,
  HelpReorderResult,
} from './ports.ts';

const NOW = new Date('2026-11-05T09:00:00.000Z');
const NEW_CATEGORY_ID = '01JD0HCAT0000000000000NEW1';
const OTHER_ID = '01JC0000000000000000000001';
const USAGE_ID = '01JD0HCAT00000000000000001';
const BILLING_ID = '01JD0HCAT00000000000000002';

const CURRENT: CurrentAdmin = Object.freeze({
  id: '01JBX8Y4Z5ABCDEFGHJKMNPQRS',
  role: 'moderator',
  nickname: '運営の管理者',
  sessionId: 'session-1',
});

const OTHER: HelpCategoryRecord = Object.freeze({
  id: OTHER_ID,
  name: 'その他',
  systemDefault: true,
  sortOrder: 3,
  articleCount: 2,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
});

const USAGE: HelpCategoryRecord = Object.freeze({
  id: USAGE_ID,
  name: '使い方',
  systemDefault: false,
  sortOrder: 1,
  articleCount: 4,
  createdAt: new Date('2026-11-02T00:00:00.000Z'),
});

const BILLING: HelpCategoryRecord = Object.freeze({
  id: BILLING_ID,
  name: '料金',
  systemDefault: false,
  sortOrder: 2,
  articleCount: 0,
  createdAt: new Date('2026-11-03T00:00:00.000Z'),
});

const CREATED: HelpCategoryRecord = Object.freeze({
  id: NEW_CATEGORY_ID,
  name: '機能の要望',
  systemDefault: false,
  sortOrder: 4,
  articleCount: 0,
  createdAt: NOW,
});

const fixedClock: Clock = { now: () => new Date(NOW) };

const fixedIds: IdGenerator = { generate: () => NEW_CATEGORY_ID };

interface FakeOptions {
  readonly categories?: readonly HelpCategoryRecord[];
  readonly createResult?: 'created' | 'name-taken';
  readonly deletedRightAfterCreate?: boolean;
  readonly renameResult?: 'renamed' | 'name-taken' | 'not-found';
  readonly deleteResult?: 'deleted' | 'not-found';
  readonly reorderResult?: HelpReorderResult;
  readonly prepareError?: AppError;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const prepared: AuditEntryInput[] = [];
  const preparedEntries: PreparedAuditEntry[] = [];
  const writes: { readonly method: string; readonly input: unknown }[] = [];
  let categories: readonly HelpCategoryRecord[] = options.categories ?? [
    BILLING,
    OTHER,
    USAGE,
  ];
  const store: HelpCategoryStore = {
    list: () => {
      calls.push('list');
      return Promise.resolve(categories);
    },
    findById: (id) => {
      calls.push('findById');
      return Promise.resolve(categories.find((category) => category.id === id));
    },
    create: (input) => {
      calls.push('create');
      writes.push({ method: 'create', input });
      const result = options.createResult ?? 'created';
      if (result === 'created' && options.deletedRightAfterCreate !== true) {
        categories = [...categories, CREATED];
      }
      return Promise.resolve(result);
    },
    rename: (input) => {
      calls.push('rename');
      writes.push({ method: 'rename', input });
      return Promise.resolve(options.renameResult ?? 'renamed');
    },
    deleteAndReassign: (input) => {
      calls.push('deleteAndReassign');
      writes.push({ method: 'deleteAndReassign', input });
      return Promise.resolve(options.deleteResult ?? 'deleted');
    },
    reorder: (input) => {
      calls.push('reorder');
      writes.push({ method: 'reorder', input });
      return Promise.resolve(options.reorderResult ?? 'reordered');
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
        targetKind: entry.targetIds.length === 0 ? null : 'category',
        targetIds: entry.targetIds,
        reason: null,
        detail: entry.detail ?? {},
        occurredAt: entry.occurredAt,
      }) as PreparedAuditEntry;
      preparedEntries.push(entryOf);
      return entryOf;
    },
    record: () => Promise.reject(new Error('単独の記録は呼ばれない想定です')),
  };
  const service = new StoreHelpCategoryService(
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
    'ヘルプ\u0001',
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

const NAME_TAKEN = {
  kind: 'conflict',
  code: 'help_category_name_taken',
  details: [
    {
      field: 'name',
      code: 'name-taken',
      message: '同じ名前のカテゴリが既にあります。',
    },
  ],
} as const;

const PROTECTED = {
  kind: 'conflict',
  code: 'help_category_protected',
  details: undefined,
} as const;

const NOT_FOUND = {
  kind: 'not_found',
  code: 'help_category_not_found',
  details: undefined,
} as const;

describe('StoreHelpCategoryService.list', () => {
  test('並び順の順で、記事の件数を付けたまま返す', async () => {
    const { service, calls } = setup();

    const categories = await service.list();

    expect(categories).toEqual([USAGE, BILLING, OTHER]);
    expect(calls).toEqual(['list']);
  });
});

describe('StoreHelpCategoryService.create', () => {
  test('前後の空白を除いた名前で、監査ログを準備してから保存し、末尾に置かれたカテゴリを返す', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup();

    const created = await service.create(CURRENT, { name: '  機能の要望 ' });

    expect(created).toEqual(CREATED);
    expect(calls).toEqual(['prepare', 'create', 'findById']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'help-category.create',
        targetIds: [NEW_CATEGORY_ID],
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'create',
        input: {
          id: NEW_CATEGORY_ID,
          name: '機能の要望',
          now: NOW,
          audit: preparedEntries[0],
        },
      },
    ]);
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

  test('ストアが大文字小文字を区別しない重複を返すと名前の重複のエラーにする', async () => {
    const { service, calls } = setup({ createResult: 'name-taken' });

    const error = await rejectionOf(
      service.create(CURRENT, { name: '使い方' }),
    );

    expect(summaryOf(error)).toEqual(NAME_TAKEN);
    expect(calls).toEqual(['prepare', 'create']);
  });

  test('保存の直後に別の画面で消されていればカテゴリの不在のエラーにする', async () => {
    const { service } = setup({ deletedRightAfterCreate: true });

    const error = await rejectionOf(
      service.create(CURRENT, { name: '機能の要望' }),
    );

    expect(summaryOf(error)).toEqual(NOT_FOUND);
  });

  test('監査ログの準備が拒否すると保存しない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(
      service.create(CURRENT, { name: '機能の要望' }),
    );

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['prepare']);
  });
});

describe('StoreHelpCategoryService.rename', () => {
  test('名前の検証・存在・保護の確認、監査ログの準備、保存の順に行い、変更後のカテゴリを返す', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup();

    const renamed = await service.rename(CURRENT, {
      id: USAGE_ID,
      name: ' 使い方ガイド ',
    });

    expect(renamed).toEqual({ ...USAGE, name: '使い方ガイド' });
    expect(calls).toEqual(['findById', 'prepare', 'rename']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'help-category.rename',
        targetIds: [USAGE_ID],
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'rename',
        input: {
          id: USAGE_ID,
          name: '使い方ガイド',
          now: NOW,
          audit: preparedEntries[0],
        },
      },
    ]);
  });

  test.each(NAME_VIOLATIONS)(
    '%s名前を、対象の確認の前に検証のエラーで拒否する',
    async (_, name, code, message) => {
      const { service, calls } = setup();

      const error = await rejectionOf(
        service.rename(CURRENT, { id: OTHER_ID, name }),
      );

      expect(summaryOf(error)).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        details: [{ field: 'name', code, message }],
      });
      expect(calls).toEqual([]);
    },
  );

  test('存在しないカテゴリを、保護の確認と監査ログの準備の前にカテゴリの不在のエラーにする', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.rename(CURRENT, { id: NEW_CATEGORY_ID, name: '機能の要望' }),
    );

    expect(summaryOf(error)).toEqual(NOT_FOUND);
    expect(calls).toEqual(['findById']);
  });

  test('標準カテゴリの名前の変更を、監査ログの準備の前に拒否する', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.rename(CURRENT, { id: OTHER_ID, name: 'そのほか' }),
    );

    expect(summaryOf(error)).toEqual(PROTECTED);
    expect(calls).toEqual(['findById']);
  });

  test.each([
    ['name-taken', NAME_TAKEN],
    ['not-found', NOT_FOUND],
  ] as const)(
    'ストアが%sを返すと対応するエラーにする',
    async (renameResult, expected) => {
      const { service } = setup({ renameResult });

      const error = await rejectionOf(
        service.rename(CURRENT, { id: USAGE_ID, name: '料金' }),
      );

      expect(summaryOf(error)).toEqual(expected);
    },
  );

  test('監査ログの準備が拒否すると変更しない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(
      service.rename(CURRENT, { id: USAGE_ID, name: '使い方ガイド' }),
    );

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['findById', 'prepare']);
  });
});

describe('StoreHelpCategoryService.delete', () => {
  test('付け替える記事の件数を監査ログの詳細に文字列で入れて準備してから、削除と付け替えを行い、件数を返す', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup();

    const result = await service.delete(CURRENT, { id: USAGE_ID });

    expect(result).toEqual({ id: USAGE_ID, reassignedCount: 4 });
    expect(calls).toEqual(['findById', 'prepare', 'deleteAndReassign']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'help-category.delete',
        targetIds: [USAGE_ID],
        detail: { reassignedCount: '4' },
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'deleteAndReassign',
        input: { id: USAGE_ID, audit: preparedEntries[0] },
      },
    ]);
  });

  test('記事の無いカテゴリは件数0で削除する', async () => {
    const { service, prepared } = setup();

    const result = await service.delete(CURRENT, { id: BILLING_ID });

    expect(result).toEqual({ id: BILLING_ID, reassignedCount: 0 });
    expect(prepared[0]?.detail).toEqual({ reassignedCount: '0' });
  });

  test('存在しないカテゴリを、監査ログの準備の前にカテゴリの不在のエラーにする', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.delete(CURRENT, { id: NEW_CATEGORY_ID }),
    );

    expect(summaryOf(error)).toEqual(NOT_FOUND);
    expect(calls).toEqual(['findById']);
  });

  test('標準カテゴリの削除を、監査ログの準備の前に拒否する', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(service.delete(CURRENT, { id: OTHER_ID }));

    expect(summaryOf(error)).toEqual(PROTECTED);
    expect(calls).toEqual(['findById']);
  });

  test('確認の後に消されていればカテゴリの不在のエラーにする', async () => {
    const { service } = setup({ deleteResult: 'not-found' });

    const error = await rejectionOf(service.delete(CURRENT, { id: USAGE_ID }));

    expect(summaryOf(error)).toEqual(NOT_FOUND);
  });

  test('監査ログの準備が拒否すると削除しない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(service.delete(CURRENT, { id: USAGE_ID }));

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['findById', 'prepare']);
  });
});

describe('StoreHelpCategoryService.reorder', () => {
  const ORDERED_IDS = [OTHER_ID, BILLING_ID, USAGE_ID];

  test('対象を持たず件数を詳細に入れた監査ログを準備してから並べ替え、並べ替えた後の一覧を返す', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup();

    const categories = await service.reorder(CURRENT, {
      orderedIds: ORDERED_IDS,
    });

    expect(categories).toEqual([USAGE, BILLING, OTHER]);
    expect(calls).toEqual(['prepare', 'reorder', 'list']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'help-category.reorder',
        targetIds: [],
        detail: { count: '3' },
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'reorder',
        input: { orderedIds: ORDERED_IDS, audit: preparedEntries[0] },
      },
    ]);
  });

  test('標準カテゴリも保護の判定をせずに並べ替えの対象にする', async () => {
    const { service, calls } = setup();

    await service.reorder(CURRENT, { orderedIds: [OTHER_ID] });

    expect(calls).not.toContain('findById');
  });

  test('ストアがoutdatedを返すと古い並びのエラーにする', async () => {
    const { service, calls } = setup({ reorderResult: 'outdated' });

    const error = await rejectionOf(
      service.reorder(CURRENT, { orderedIds: ORDERED_IDS }),
    );

    expect(summaryOf(error)).toEqual({
      kind: 'conflict',
      code: 'help_order_outdated',
      details: undefined,
    });
    expect(calls).toEqual(['prepare', 'reorder']);
  });

  test('監査ログの準備が拒否すると並べ替えない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(
      service.reorder(CURRENT, { orderedIds: ORDERED_IDS }),
    );

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['prepare']);
  });
});
