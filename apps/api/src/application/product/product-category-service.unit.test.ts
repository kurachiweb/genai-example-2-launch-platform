import { describe, expect, test } from 'bun:test';

import {
  PRODUCT_CATEGORY_CREATE_ACTION,
  PRODUCT_CATEGORY_DELETE_ACTION,
  PRODUCT_CATEGORY_UPDATE_ACTION,
} from '../../../common-lib/admin/audit-actions/product-launch.ts';
import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../common-lib/product/product-category-constants.ts';
import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { ProductCategoryRecord } from '../../../lib/core/product/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  ProductCategoryDeleteResult,
  ProductCategoryInsertResult,
  ProductCategoryStore,
  ProductCategoryUpdateResult,
} from './ports.ts';
import { StoreProductCategoryService } from './product-category-service.ts';

const NOW = new Date('2026-11-10T03:00:00.000Z');
const NEW_CATEGORY_ID = '01JD0CATG0000000000000NEW1';
const DEV_TOOLS_ID = '01JD0CATG00000000000000001';
const AI_ID = '01JD0CATG00000000000000002';

const CURRENT: CurrentAdmin = Object.freeze({
  id: '01JBX8Y4Z5ABCDEFGHJKMNPQRS',
  role: 'moderator',
  nickname: '運営の管理者',
  sessionId: 'session-1',
});

const DEV_TOOLS: ProductCategoryRecord = Object.freeze({
  id: DEV_TOOLS_ID,
  name: '開発ツール',
  handle: 'dev-tools',
  systemDefault: false,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
});

const AI: ProductCategoryRecord = Object.freeze({
  id: AI_ID,
  name: 'AI',
  handle: 'ai',
  systemDefault: false,
  createdAt: new Date('2026-11-02T00:00:00.000Z'),
});

const OTHER: ProductCategoryRecord = Object.freeze({
  id: PRODUCT_CATEGORY_OTHER_ID,
  name: PRODUCT_CATEGORY_OTHER_NAME,
  handle: PRODUCT_CATEGORY_OTHER_HANDLE,
  systemDefault: true,
  createdAt: new Date(1_731_945_562_112),
});

const fixedClock: Clock = { now: () => new Date(NOW) };

const fixedIds: IdGenerator = { generate: () => NEW_CATEGORY_ID };

interface FakeOptions {
  readonly categories?: readonly ProductCategoryRecord[];
  readonly insertResult?: ProductCategoryInsertResult;
  readonly updateResult?: ProductCategoryUpdateResult;
  readonly deleteResult?: ProductCategoryDeleteResult;
  readonly prepareError?: AppError;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const prepared: AuditEntryInput[] = [];
  const preparedEntries: PreparedAuditEntry[] = [];
  const writes: {
    readonly method: string;
    readonly args: readonly unknown[];
  }[] = [];
  const categories = options.categories ?? [DEV_TOOLS, AI, OTHER];
  const store: ProductCategoryStore = {
    list: () => {
      calls.push('list');
      return Promise.resolve(categories);
    },
    findById: (id) => {
      calls.push('findById');
      return Promise.resolve(categories.find((category) => category.id === id));
    },
    insert: (input, audit) => {
      calls.push('insert');
      writes.push({ method: 'insert', args: [input, audit] });
      return Promise.resolve(options.insertResult ?? 'created');
    },
    update: (input, audit) => {
      calls.push('update');
      writes.push({ method: 'update', args: [input, audit] });
      return Promise.resolve(options.updateResult ?? 'updated');
    },
    delete: (id, audit) => {
      calls.push('delete');
      writes.push({ method: 'delete', args: [id, audit] });
      return Promise.resolve(options.deleteResult ?? 'deleted');
    },
  };
  // 準備済みの記録は記録の実装だけが作れるため、偽物は型の表明で作る。操作種別の検証は合成ルートを通したWorkers統合テストが確かめる
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
  const service = new StoreProductCategoryService(
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

const VALID_INPUT = Object.freeze({ name: '  開発者向け  ', handle: 'Dev' });

const NAME_VIOLATIONS = [
  [
    '使用できない文字を含む',
    '開発ツール\u0001',
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

const HANDLE_VIOLATIONS = [
  ['空の', '', 'empty', 'ハンドルを入力してください。'],
  [
    '50文字を超える',
    'a'.repeat(51),
    'too-long',
    'ハンドルは50文字以内で入力してください。',
  ],
  [
    '英数字で始まらない',
    '-tools',
    'invalid-characters',
    'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
  ],
  [
    '前後に空白を含む',
    ' tools',
    'invalid-characters',
    'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
  ],
] as const;

describe('StoreProductCategoryService.list', () => {
  test('ストアが返す追加の順(「その他」を末尾)のまま返す', async () => {
    const { service } = setup();

    const categories = await service.list();

    expect(categories.map((category) => category.id)).toEqual([
      DEV_TOOLS_ID,
      AI_ID,
      PRODUCT_CATEGORY_OTHER_ID,
    ]);
  });
});

describe('StoreProductCategoryService.create', () => {
  test('前後の空白を除いた名前と入力どおりの表記のハンドルを、追加の監査ログと同じ一括の書き込みへ渡し、標準でないカテゴリを返す', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup();

    const created = await service.create(CURRENT, VALID_INPUT, '分類の追加');

    expect(created).toEqual({
      id: NEW_CATEGORY_ID,
      name: '開発者向け',
      handle: 'Dev',
      systemDefault: false,
      createdAt: NOW,
    });
    expect(calls).toEqual(['prepare', 'insert']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: PRODUCT_CATEGORY_CREATE_ACTION.name,
        targetIds: [NEW_CATEGORY_ID],
        reason: '分類の追加',
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'insert',
        args: [
          {
            id: NEW_CATEGORY_ID,
            name: '開発者向け',
            handle: 'Dev',
            at: NOW,
          },
          preparedEntries[0],
        ],
      },
    ]);
  });

  test('理由を省くと、監査ログの入力に理由を含めない', async () => {
    const { service, prepared } = setup();

    await service.create(CURRENT, VALID_INPUT, undefined);

    expect(prepared[0]).not.toHaveProperty('reason');
  });

  test('なりすましの予約語と同じハンドルも、カテゴリのハンドルでは受け付ける', async () => {
    const { service, calls } = setup();

    const created = await service.create(
      CURRENT,
      { name: '運営', handle: 'admin' },
      undefined,
    );

    expect(created.handle).toBe('admin');
    expect(calls).toEqual(['prepare', 'insert']);
  });

  test.each(NAME_VIOLATIONS)(
    '%s名前は、カテゴリ名の欄の詳細を持つvalidation_errorで拒否し、記録もストアも呼ばない',
    async (_, name, code, message) => {
      const { service, calls } = setup();

      const error = await rejectionOf(
        service.create(CURRENT, { name, handle: 'tools' }, undefined),
      );

      expect(summaryOf(error)).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        details: [{ field: 'name', code, message }],
      });
      expect(calls).toEqual([]);
    },
  );

  test.each(HANDLE_VIOLATIONS)(
    '%sハンドルは、ハンドルの欄の詳細を持つvalidation_errorで拒否し、記録もストアも呼ばない',
    async (_, handle, code, message) => {
      const { service, calls } = setup();

      const error = await rejectionOf(
        service.create(CURRENT, { name: '開発ツール', handle }, undefined),
      );

      expect(summaryOf(error)).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        details: [{ field: 'handle', code, message }],
      });
      expect(calls).toEqual([]);
    },
  );

  test('名前とハンドルの両方の違反は、カテゴリ名・ハンドルの順に両方の欄の詳細を返す', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.create(CURRENT, { name: '', handle: '' }, undefined),
    );

    expect(error.details).toEqual([
      {
        field: 'name',
        code: 'empty',
        message: 'カテゴリ名を入力してください。',
      },
      {
        field: 'handle',
        code: 'empty',
        message: 'ハンドルを入力してください。',
      },
    ]);
  });

  test.each([
    ['name-taken', 'product_category_name_taken', 'conflict'],
    ['handle-taken', 'product_category_handle_taken', 'conflict'],
  ] as const)(
    'ストアが%sを返すと%sで拒否する',
    async (insertResult, code, kind) => {
      const { service } = setup({ insertResult });

      const error = await rejectionOf(
        service.create(CURRENT, VALID_INPUT, undefined),
      );

      expect(error.code).toBe(code);
      expect(error.kind).toBe(kind);
    },
  );

  test('監査ログの準備の違反はそのまま投げ、ストアを呼ばない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(
      service.create(CURRENT, VALID_INPUT, 'あ'.repeat(501)),
    );

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['prepare']);
  });
});

describe('StoreProductCategoryService.update', () => {
  test('名前とハンドルを、変更の監査ログと同じ一括の書き込みへ渡し、変更後のカテゴリを返す', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup();

    const updated = await service.update(
      CURRENT,
      DEV_TOOLS_ID,
      { name: ' 開発者ツール ', handle: 'developer-tools' },
      '表記の統一',
    );

    expect(updated).toEqual({
      ...DEV_TOOLS,
      name: '開発者ツール',
      handle: 'developer-tools',
    });
    expect(calls).toEqual(['findById', 'prepare', 'update']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: PRODUCT_CATEGORY_UPDATE_ACTION.name,
        targetIds: [DEV_TOOLS_ID],
        reason: '表記の統一',
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      {
        method: 'update',
        args: [
          {
            id: DEV_TOOLS_ID,
            name: '開発者ツール',
            handle: 'developer-tools',
            at: NOW,
          },
          preparedEntries[0],
        ],
      },
    ]);
  });

  test('理由を省くと、監査ログの入力に理由を含めない', async () => {
    const { service, prepared } = setup();

    await service.update(CURRENT, DEV_TOOLS_ID, VALID_INPUT, undefined);

    expect(prepared[0]).not.toHaveProperty('reason');
  });

  test('入力の違反は、カテゴリを読む前にvalidation_errorで拒否する', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.update(
        CURRENT,
        PRODUCT_CATEGORY_OTHER_ID,
        { name: '', handle: 'other' },
        undefined,
      ),
    );

    expect(error.code).toBe('validation_error');
    expect(calls).toEqual([]);
  });

  test('存在しないカテゴリはnot_foundで拒否し、記録もストアの書き込みも呼ばない', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.update(CURRENT, NEW_CATEGORY_ID, VALID_INPUT, undefined),
    );

    expect(summaryOf(error)).toEqual({
      kind: 'not_found',
      code: 'not_found',
      details: undefined,
    });
    expect(error.message).toBe('カテゴリが見つかりません。');
    expect(calls).toEqual(['findById']);
  });

  test.each([
    ['名前の変更', { name: '雑多', handle: PRODUCT_CATEGORY_OTHER_HANDLE }],
    ['ハンドルの変更', { name: PRODUCT_CATEGORY_OTHER_NAME, handle: 'misc' }],
  ])(
    '標準カテゴリ「その他」の%sはproduct_category_protectedで拒否し、記録もストアの書き込みも呼ばない',
    async (_, input) => {
      const { service, calls } = setup();

      const error = await rejectionOf(
        service.update(CURRENT, PRODUCT_CATEGORY_OTHER_ID, input, undefined),
      );

      expect(error.code).toBe('product_category_protected');
      expect(error.kind).toBe('unprocessable');
      expect(calls).toEqual(['findById']);
    },
  );

  test.each([
    ['name-taken', 'product_category_name_taken'],
    ['handle-taken', 'product_category_handle_taken'],
    ['not-found', 'not_found'],
    ['protected', 'product_category_protected'],
  ] as const)(
    '書き込みの時点でストアが%sを返すと%sで拒否する',
    async (updateResult, code) => {
      const { service } = setup({ updateResult });

      const error = await rejectionOf(
        service.update(CURRENT, DEV_TOOLS_ID, VALID_INPUT, undefined),
      );

      expect(error.code).toBe(code);
    },
  );

  test('監査ログの準備の違反はそのまま投げ、ストアの書き込みを呼ばない', async () => {
    const { service, calls } = setup({ prepareError: PREPARE_REJECTION });

    const error = await rejectionOf(
      service.update(CURRENT, DEV_TOOLS_ID, VALID_INPUT, undefined),
    );

    expect(error).toBe(PREPARE_REJECTION);
    expect(calls).toEqual(['findById', 'prepare']);
  });
});

describe('StoreProductCategoryService.delete', () => {
  test('削除の監査ログと同じ一括の書き込みでカテゴリを削除する', async () => {
    const { service, calls, prepared, preparedEntries, writes } = setup();

    await service.delete(CURRENT, AI_ID, '統合のため');

    expect(calls).toEqual(['findById', 'prepare', 'delete']);
    expect(prepared).toEqual([
      {
        operatorAdminId: CURRENT.id,
        action: PRODUCT_CATEGORY_DELETE_ACTION.name,
        targetIds: [AI_ID],
        reason: '統合のため',
        occurredAt: NOW,
      },
    ]);
    expect(writes).toEqual([
      { method: 'delete', args: [AI_ID, preparedEntries[0]] },
    ]);
  });

  test('理由を省くと、監査ログの入力に理由を含めない', async () => {
    const { service, prepared } = setup();

    await service.delete(CURRENT, AI_ID, undefined);

    expect(prepared[0]).not.toHaveProperty('reason');
  });

  test('存在しないカテゴリはnot_foundで拒否し、記録もストアの書き込みも呼ばない', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.delete(CURRENT, NEW_CATEGORY_ID, undefined),
    );

    expect(error.code).toBe('not_found');
    expect(calls).toEqual(['findById']);
  });

  test('標準カテゴリ「その他」はproduct_category_protectedで拒否し、記録もストアの書き込みも呼ばない', async () => {
    const { service, calls } = setup();

    const error = await rejectionOf(
      service.delete(CURRENT, PRODUCT_CATEGORY_OTHER_ID, undefined),
    );

    expect(error.code).toBe('product_category_protected');
    expect(calls).toEqual(['findById']);
  });

  test.each([
    ['in-use', 'product_category_in_use', 'conflict'],
    ['not-found', 'not_found', 'not_found'],
    ['protected', 'product_category_protected', 'unprocessable'],
  ] as const)(
    '書き込みの時点でストアが%sを返すと%sで拒否する',
    async (deleteResult, code, kind) => {
      const { service } = setup({ deleteResult });

      const error = await rejectionOf(
        service.delete(CURRENT, AI_ID, undefined),
      );

      expect(error.code).toBe(code);
      expect(error.kind).toBe(kind);
    },
  );

  test('紐付くプロダクトがある旨の文言で拒否する', async () => {
    const { service } = setup({ deleteResult: 'in-use' });

    const error = await rejectionOf(service.delete(CURRENT, AI_ID, undefined));

    expect(error.message).toBe(
      'このカテゴリにはプロダクトが紐付いているため削除できません。削除から14日以内のプロダクトも含みます。',
    );
  });
});
