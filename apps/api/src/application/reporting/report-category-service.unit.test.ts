import { describe, expect, test } from 'bun:test';

import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_OTHER_ID,
} from '../../../common-lib/reporting/report-rules.ts';
import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { ReportCategoryRecord, ReportCategoryStore } from './ports.ts';
import { DefaultReportCategoryService } from './report-category-service.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');
const NEW_CATEGORY_ID = '01JF00000000000000000NEW01';
const SPAM_ID = '01JF000000000000000000SPAM';
const ABUSE_ID = '01JF00000000000000000ABUSE';

const CURRENT: CurrentAdmin = Object.freeze({
  id: '01JBX8Y4Z5ABCDEFGHJKMNPQRS',
  role: 'moderator',
  nickname: '運営の管理者',
  sessionId: 'session-1',
});

const SEEDED_AT = new Date('2026-11-22T05:48:30.000Z');

const INFRINGEMENT: ReportCategoryRecord = Object.freeze({
  id: REPORT_CATEGORY_INFRINGEMENT_ID,
  name: '権利侵害',
  systemDefault: true,
  createdAt: SEEDED_AT,
});

const OTHER: ReportCategoryRecord = Object.freeze({
  id: REPORT_CATEGORY_OTHER_ID,
  name: 'その他',
  systemDefault: true,
  createdAt: SEEDED_AT,
});

const SPAM: ReportCategoryRecord = Object.freeze({
  id: SPAM_ID,
  name: 'スパム',
  systemDefault: false,
  createdAt: new Date('2027-01-01T00:00:00.000Z'),
});

const ABUSE: ReportCategoryRecord = Object.freeze({
  id: ABUSE_ID,
  name: '誹謗中傷',
  systemDefault: false,
  createdAt: new Date('2027-02-01T00:00:00.000Z'),
});

const fixedClock: Clock = { now: () => new Date(NOW) };

const fixedIds: IdGenerator = { generate: () => NEW_CATEGORY_ID };

interface FakeOptions {
  readonly categories?: readonly ReportCategoryRecord[];
  readonly reportCounts?: ReadonlyMap<string, number>;
  readonly insertResult?: 'created' | 'name-taken';
  readonly renameResult?: 'renamed' | 'name-taken' | 'not-found';
  readonly deleteResult?: 'deleted' | 'not-found';
  readonly prepareError?: AppError;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const prepared: AuditEntryInput[] = [];
  const preparedEntries: PreparedAuditEntry[] = [];
  const categories = options.categories ?? [ABUSE, OTHER, SPAM, INFRINGEMENT];
  const reportCounts = options.reportCounts ?? new Map<string, number>();
  const writes: {
    readonly method: string;
    readonly args: readonly unknown[];
  }[] = [];
  const store: ReportCategoryStore = {
    list: () => {
      calls.push('list');
      return Promise.resolve(
        categories.map((category) => ({
          ...category,
          reportCount: reportCounts.get(category.id) ?? 0,
        })),
      );
    },
    find: (id) => {
      calls.push('find');
      return Promise.resolve(categories.find((category) => category.id === id));
    },
    countReports: (id) => {
      calls.push('countReports');
      return Promise.resolve(reportCounts.get(id) ?? 0);
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
    deleteAndReassign: (id, at, audit) => {
      calls.push('deleteAndReassign');
      writes.push({ method: 'deleteAndReassign', args: [id, at, audit] });
      return Promise.resolve(options.deleteResult ?? 'deleted');
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
  const service = new DefaultReportCategoryService(
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
  ['空白だけの', ' 　 ', 'empty', 'カテゴリ名を入力してください。'],
  [
    '30書記素を超える',
    'あ'.repeat(31),
    'too-long',
    'カテゴリ名は30文字以内で入力してください。',
  ],
  [
    '使用できない文字を含む',
    'スパム\u0001',
    'forbidden-character',
    'カテゴリ名に使用できない文字が含まれています。',
  ],
] as const;

const PROTECTED = {
  kind: 'unprocessable',
  code: 'report_category_protected',
  details: undefined,
} as const;

const NOT_FOUND = {
  kind: 'not_found',
  code: 'report_category_not_found',
  details: undefined,
} as const;

describe('DefaultReportCategoryService.listForForm', () => {
  test('追加の順に並べ、「権利侵害」「その他」をこの順で末尾に置き、権利侵害の印を付ける', async () => {
    const { service } = setup();

    const categories = await service.listForForm();

    expect(categories).toEqual([
      { id: SPAM_ID, name: 'スパム', infringement: false },
      { id: ABUSE_ID, name: '誹謗中傷', infringement: false },
      {
        id: REPORT_CATEGORY_INFRINGEMENT_ID,
        name: '権利侵害',
        infringement: true,
      },
      { id: REPORT_CATEGORY_OTHER_ID, name: 'その他', infringement: false },
    ]);
  });

  test('利用者側に件数と標準の印を渡さない', async () => {
    const { service } = setup({
      reportCounts: new Map([[SPAM_ID, 5]]),
    });

    const categories = await service.listForForm();

    for (const category of categories) {
      expect(Object.keys(category).sort()).toEqual([
        'id',
        'infringement',
        'name',
      ]);
    }
  });
});

describe('DefaultReportCategoryService.listForAdmin', () => {
  test('フォームと同じ並びで、標準の印と紐付く通報の件数を付ける', async () => {
    const { service, calls } = setup({
      reportCounts: new Map([
        [SPAM_ID, 4],
        [REPORT_CATEGORY_OTHER_ID, 12],
      ]),
    });

    const categories = await service.listForAdmin();

    expect(categories).toEqual([
      {
        id: SPAM_ID,
        name: 'スパム',
        systemDefault: false,
        infringement: false,
        reportCount: 4,
      },
      {
        id: ABUSE_ID,
        name: '誹謗中傷',
        systemDefault: false,
        infringement: false,
        reportCount: 0,
      },
      {
        id: REPORT_CATEGORY_INFRINGEMENT_ID,
        name: '権利侵害',
        systemDefault: true,
        infringement: true,
        reportCount: 0,
      },
      {
        id: REPORT_CATEGORY_OTHER_ID,
        name: 'その他',
        systemDefault: true,
        infringement: false,
        reportCount: 12,
      },
    ]);
    expect(calls).toEqual(['list']);
  });
});

describe('DefaultReportCategoryService.create', () => {
  test('前後の空白を除いた名前で、監査ログを準備してから保存する', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup();

    const created = await service.create(CURRENT, {
      name: '  なりすまし ',
      reason: '通報の傾向に合わせる',
    });

    expect(created).toEqual({
      id: NEW_CATEGORY_ID,
      name: 'なりすまし',
      systemDefault: false,
      infringement: false,
      reportCount: 0,
    });
    expect(calls).toEqual(['prepare', 'insert']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'report-category.create',
        targetIds: [NEW_CATEGORY_ID],
        reason: '通報の傾向に合わせる',
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'insert',
        args: [
          { id: NEW_CATEGORY_ID, name: 'なりすまし', at: NOW },
          preparedEntries[0],
        ],
      },
    ]);
    expect(writes[0]?.args[1]).toBe(preparedEntries[0]);
  });

  test('理由が無ければ監査ログの入力に理由を含めない', async () => {
    const { service, prepared } = setup();

    await service.create(CURRENT, { name: 'なりすまし' });

    expect(prepared[0]).not.toHaveProperty('reason');
  });

  test('監査ログにカテゴリ名を含めない', async () => {
    const { service, prepared } = setup();

    await service.create(CURRENT, { name: 'なりすまし' });

    expect(JSON.stringify(prepared)).not.toContain('なりすまし');
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

  test('30書記素ちょうどの名前は受け付ける', async () => {
    const { service } = setup();

    const created = await service.create(CURRENT, {
      name: '👨‍👩‍👧'.repeat(30),
    });

    expect(created.name).toBe('👨‍👩‍👧'.repeat(30));
  });

  test('大文字小文字を区別しない重複をストアが返すと名前の重複のエラーにする', async () => {
    const { service } = setup({ insertResult: 'name-taken' });

    const error = await rejectionOf(service.create(CURRENT, { name: 'spam' }));

    expect(summaryOf(error)).toEqual({
      kind: 'conflict',
      code: 'report_category_name_taken',
      details: [
        {
          field: 'name',
          code: 'name-taken',
          message: '同じ名前のカテゴリがあります。',
        },
      ],
    });
  });

  test('監査ログの準備が拒否すると保存しない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(
      service.create(CURRENT, { name: 'なりすまし', reason: 'x' }),
    );

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['prepare']);
  });
});

describe('DefaultReportCategoryService.rename', () => {
  test('対象を確かめ、監査ログを準備してから前後の空白を除いた名前で変更し、件数付きで返す', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup({
      reportCounts: new Map([[SPAM_ID, 7]]),
    });

    const renamed = await service.rename(CURRENT, {
      id: SPAM_ID,
      name: ' スパム・宣伝 ',
      reason: '名前を分かりやすくする',
    });

    expect(renamed).toEqual({
      id: SPAM_ID,
      name: 'スパム・宣伝',
      systemDefault: false,
      infringement: false,
      reportCount: 7,
    });
    expect(calls).toEqual(['find', 'prepare', 'rename', 'countReports']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'report-category.rename',
        targetIds: [SPAM_ID],
        reason: '名前を分かりやすくする',
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'rename',
        args: [SPAM_ID, 'スパム・宣伝', NOW, preparedEntries[0]],
      },
    ]);
    expect(writes[0]?.args[3]).toBe(preparedEntries[0]);
  });

  test('理由が無ければ監査ログの入力に理由を含めない', async () => {
    const { service, prepared } = setup();

    await service.rename(CURRENT, { id: SPAM_ID, name: '宣伝' });

    expect(prepared[0]).not.toHaveProperty('reason');
  });

  test.each([
    ['権利侵害', REPORT_CATEGORY_INFRINGEMENT_ID],
    ['その他', REPORT_CATEGORY_OTHER_ID],
  ])(
    '標準カテゴリ「%s」の名前の変更を、監査ログの準備の前に拒否する',
    async (_, id) => {
      const { service, calls } = setup();

      const error = await rejectionOf(
        service.rename(CURRENT, { id, name: '別の名前' }),
      );

      expect(summaryOf(error)).toEqual(PROTECTED);
      expect(calls).toEqual(['find']);
    },
  );

  test('存在しないカテゴリをカテゴリの不在のエラーにする', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.rename(CURRENT, { id: NEW_CATEGORY_ID, name: 'なりすまし' }),
    );

    expect(summaryOf(error)).toEqual(NOT_FOUND);
    expect(calls).toEqual(['find']);
  });

  test.each(NAME_VIOLATIONS)(
    '%s名前を、対象の確認の前に検証のエラーで拒否する',
    async (_, name, code, message) => {
      const { service, calls } = setup();

      const error = await rejectionOf(
        service.rename(CURRENT, { id: SPAM_ID, name }),
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
    ['name-taken', 'conflict', 'report_category_name_taken'],
    ['not-found', 'not_found', 'report_category_not_found'],
  ] as const)(
    'ストアが%sを返すと%sの種類のエラーにし、件数を数えない',
    async (renameResult, kind, code) => {
      const { service, calls } = setup({ renameResult });

      const error = await rejectionOf(
        service.rename(CURRENT, { id: SPAM_ID, name: '誹謗中傷' }),
      );

      expect({ kind: error.kind, code: error.code }).toEqual({ kind, code });
      expect(calls).not.toContain('countReports');
    },
  );

  test('監査ログの準備が拒否すると変更しない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(
      service.rename(CURRENT, { id: SPAM_ID, name: '宣伝' }),
    );

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['find', 'prepare']);
  });
});

describe('DefaultReportCategoryService.delete', () => {
  test('付け替える件数を数えて監査ログの詳細に入れて準備してから、付け替えと削除を行う', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup({
      reportCounts: new Map([[SPAM_ID, 3]]),
    });

    const result = await service.delete(CURRENT, {
      id: SPAM_ID,
      reason: '使われなくなった',
    });

    expect(result).toEqual({ reassignedCount: 3 });
    expect(calls).toEqual([
      'find',
      'countReports',
      'prepare',
      'deleteAndReassign',
    ]);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: 'report-category.delete',
        targetIds: [SPAM_ID],
        reason: '使われなくなった',
        detail: { reassignedCount: '3' },
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'deleteAndReassign',
        args: [SPAM_ID, NOW, preparedEntries[0]],
      },
    ]);
    expect(writes[0]?.args[2]).toBe(preparedEntries[0]);
  });

  test('紐付く通報が無ければ付け替えた件数を0として記録し、理由が無ければ含めない', async () => {
    const { service, prepared } = setup();

    const result = await service.delete(CURRENT, { id: ABUSE_ID });

    expect(result).toEqual({ reassignedCount: 0 });
    expect(prepared[0]?.detail).toEqual({ reassignedCount: '0' });
    expect(prepared[0]).not.toHaveProperty('reason');
  });

  test.each([
    ['権利侵害', REPORT_CATEGORY_INFRINGEMENT_ID],
    ['その他', REPORT_CATEGORY_OTHER_ID],
  ])(
    '標準カテゴリ「%s」の削除を、件数の照会と監査ログの準備の前に拒否する',
    async (_, id) => {
      const { service, calls } = setup();

      const error = await rejectionOf(service.delete(CURRENT, { id }));

      expect(summaryOf(error)).toEqual(PROTECTED);
      expect(calls).toEqual(['find']);
    },
  );

  test('存在しないカテゴリをカテゴリの不在のエラーにする', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.delete(CURRENT, { id: NEW_CATEGORY_ID }),
    );

    expect(summaryOf(error)).toEqual(NOT_FOUND);
    expect(calls).toEqual(['find']);
  });

  test('削除の時点で消えていればカテゴリの不在のエラーにする', async () => {
    const { service } = setup({ deleteResult: 'not-found' });

    const error = await rejectionOf(service.delete(CURRENT, { id: SPAM_ID }));

    expect(summaryOf(error)).toEqual(NOT_FOUND);
  });

  test('監査ログの準備が拒否すると削除しない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(service.delete(CURRENT, { id: SPAM_ID }));

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['find', 'countReports', 'prepare']);
  });
});
