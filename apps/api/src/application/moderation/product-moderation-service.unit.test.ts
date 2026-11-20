import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  ProductDirectory,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import { productError } from '../product/product-errors.ts';
import type {
  ProductVisibilityControl,
  VisibilityChangeResult,
} from '../product/product-visibility-control.ts';
import { MODERATION_ERRORS } from './moderation-errors.ts';
import type {
  ModerationNoticeDispatch,
  ModerationNotifier,
} from './moderation-notifier.ts';
import {
  InMemoryPendingModerationRecord,
  type PendingModeration,
} from './pending-moderation-record.ts';
import type {
  ModerationCommand,
  ModerationIncident,
  ModerationIncidentContext,
  ModerationIncidentReporter,
  ModerationWriteParticipation,
} from './ports.ts';
import {
  DefaultProductModerationService,
  type ProductModerationService,
} from './product-moderation-service.ts';

const AT = new Date('2026-11-20T03:00:00.000Z');
const PRODUCT_ID = '01JQ0PRD000000000000000001';
const OWNER_ID = '01JQ0USR000000000000000001';
const ADMIN_ID = '01JQ0ADM000000000000000001';
const ACTION_ID = '01JQ0MDR000000000000000001';
const PRODUCT_NAME = '秘密のプロダクト名';
const PRODUCT_HANDLE = 'secret-product';
const REASON = '規約に反する内容を掲載していたため';

type Operation = 'hide' | 'unhide';

const OPERATIONS = [
  {
    operation: 'hide',
    label: '非公開化',
    action: 'product.hide',
    lifecycleEvent: 'hidden',
    noticeStatus: 'pending',
    currentHidden: false,
    sameHidden: true,
  },
  {
    operation: 'unhide',
    label: '復元',
    action: 'product.unhide',
    lifecycleEvent: 'unhidden',
    noticeStatus: 'none',
    currentHidden: true,
    sameHidden: false,
  },
] as const;

const productOf = (
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord => ({
  productId: PRODUCT_ID,
  ownerUserId: OWNER_ID,
  handle: PRODUCT_HANDLE,
  name: PRODUCT_NAME,
  tagline: '秘密のキャッチコピー',
  category: { id: '01JQ0CAT000000000000000001', name: '開発', handle: 'dev' },
  websiteUrl: 'https://product.example/',
  logoFileId: '01JQ0FIL000000000000000001',
  hidden: false,
  visible: true,
  listed: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const commandOf = (
  overrides: Partial<ModerationCommand> = {},
): ModerationCommand => ({
  targetId: PRODUCT_ID,
  reason: `  ${REASON}\n`,
  operator: { adminId: ADMIN_ID },
  at: AT,
  ...overrides,
});

type VisibilityBehavior =
  | { readonly kind: 'commit'; readonly takes: boolean }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'throw'; readonly error: Error };

interface HarnessOptions {
  readonly products?: readonly ProductSummaryRecord[];
  readonly visibility?: VisibilityBehavior;
  readonly dispatchError?: Error;
}

const COMMIT_AND_TAKE: VisibilityBehavior = { kind: 'commit', takes: true };

class RecordingPendingModerationRecord extends InMemoryPendingModerationRecord {
  constructor(private readonly calls: string[]) {
    super();
  }

  override set(pending: PendingModeration): void {
    this.calls.push('pending.set');
    super.set(pending);
  }

  override clear(): void {
    this.calls.push('pending.clear');
    super.clear();
  }
}

const harnessOf = (options: HarnessOptions = {}) => {
  const calls: string[] = [];
  const lookups: {
    productIds: readonly string[];
    scope: ProductLookupScope;
  }[] = [];
  const prepared: AuditEntryInput[] = [];
  const preparedEntries: PreparedAuditEntry[] = [];
  const transitions: { operation: Operation; productId: string; at: Date }[] =
    [];
  const pendingAtTransition: (PendingModeration | undefined)[] = [];
  const reports: {
    incident: ModerationIncident;
    context: ModerationIncidentContext;
  }[] = [];
  const dispatched: string[] = [];
  const pending = new RecordingPendingModerationRecord(calls);
  const products: ProductDirectory = {
    findSummaries: (productIds, scope) => {
      calls.push('products.findSummaries');
      lookups.push({ productIds, scope });
      const found = (options.products ?? [productOf()]).filter(
        ({ productId }) => productIds.includes(productId),
      );
      return Promise.resolve(
        new Map(found.map((product) => [product.productId, product])),
      );
    },
    resolveHandle: () =>
      Promise.reject(new Error('ハンドルの解決は呼ばれない想定です')),
    findDetail: () => Promise.reject(new Error('詳細は呼ばれない想定です')),
    listLaunches: () =>
      Promise.reject(new Error('ローンチの一覧は呼ばれない想定です')),
  };
  // 同期の処理は確定の一括の書き込みを組み立てるときに保留中の措置を取り出すため、偽物の確定でも同じ時機に取り出す
  const transit = (
    operation: Operation,
    lifecycleEvent: string,
    productId: string,
    at: Date,
  ): Promise<VisibilityChangeResult> => {
    calls.push(`visibility.${operation}`);
    transitions.push({ operation, productId, at });
    const behavior = options.visibility ?? COMMIT_AND_TAKE;
    if (behavior.kind === 'throw') {
      return Promise.reject(behavior.error);
    }
    if (behavior.kind === 'unchanged') {
      return Promise.resolve('unchanged');
    }
    if (behavior.takes) {
      pendingAtTransition.push(
        pending.take({ type: lifecycleEvent, targetId: productId }),
      );
    }
    return Promise.resolve('changed');
  };
  const visibility: ProductVisibilityControl = {
    hide: (productId, at) => transit('hide', 'hidden', productId, at),
    unhide: (productId, at) => transit('unhide', 'unhidden', productId, at),
  };
  // 準備済みの記録は記録の実装だけが作れるため、偽物は型の表明で作る。操作種別の検証は操作種別の定義の単体テストとWorkers統合テストが確かめる
  const auditLog: AuditLogRecorder = {
    prepare: (entry) => {
      calls.push('audit.prepare');
      prepared.push(entry);
      const entryOf = Object.freeze({
        id: `audit-${String(prepared.length)}`,
        operatorAdminId: entry.operatorAdminId,
        action: entry.action,
        targetKind: 'product',
        targetIds: entry.targetIds,
        reason: entry.reason ?? null,
        detail: entry.detail ?? {},
        occurredAt: entry.occurredAt,
      }) as unknown as PreparedAuditEntry;
      preparedEntries.push(entryOf);
      return entryOf;
    },
    record: () => Promise.reject(new Error('単独の記録は呼ばれない想定です')),
  };
  const reporter: ModerationIncidentReporter = {
    report: (incident, context) => {
      calls.push(`report:${incident}`);
      reports.push({ incident, context });
    },
  };
  const notifier: ModerationNotifier = {
    dispatch: (actionId): Promise<ModerationNoticeDispatch> => {
      calls.push('notifier.dispatch');
      dispatched.push(actionId);
      if (options.dispatchError !== undefined) {
        return Promise.reject(options.dispatchError);
      }
      return Promise.resolve('requested');
    },
  };
  const service: ProductModerationService = new DefaultProductModerationService(
    products,
    visibility,
    auditLog,
    { generate: () => ACTION_ID },
    pending,
    reporter,
    notifier,
  );
  return {
    service,
    pending,
    calls,
    lookups,
    prepared,
    preparedEntries,
    transitions,
    pendingAtTransition,
    reports,
    dispatched,
  };
};

const run = (
  harness: ReturnType<typeof harnessOf>,
  operation: Operation,
  command: ModerationCommand = commandOf(),
) => harness.service[operation](command);

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('例外が投げられませんでした');
    },
    (error: unknown) => error,
  );

const appErrorOf = async (promise: Promise<unknown>): Promise<AppError> => {
  const error = await rejectionOf(promise);
  if (!(error instanceof AppError)) {
    throw new Error(`AppErrorではありません: ${String(error)}`);
  }
  return error;
};

const logs: LogRecord[] = [];

beforeEach(() => {
  logs.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        logs.push(record);
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

const moderationLogs = () =>
  logs
    .filter(
      (record) => record.category.join('.') === 'api.application.moderation',
    )
    .map(({ level, properties }) => ({ level, properties }));

describe.each(OPERATIONS)(
  'DefaultProductModerationService $label',
  ({
    operation,
    action,
    lifecycleEvent,
    noticeStatus,
    currentHidden,
    sameHidden,
  }) => {
    const currentHarness = (options: HarnessOptions = {}) =>
      harnessOf({
        products: [productOf({ hidden: currentHidden })],
        ...options,
      });

    test('論理削除済みを除く照会で対象を読み、前後の空白を除いた理由でプロダクトを対象にした監査ログを準備し、保留中の措置を置いてから公開状態を変える', async () => {
      const harness = currentHarness();

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
      expect(harness.lookups).toEqual([
        { productIds: [PRODUCT_ID], scope: 'not-deleted' },
      ]);
      expect(harness.prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action,
          targetIds: [PRODUCT_ID],
          reason: REASON,
          occurredAt: AT,
        },
      ]);
      expect(harness.transitions).toEqual([
        { operation, productId: PRODUCT_ID, at: AT },
      ]);
      expect(harness.calls.slice(0, 4)).toEqual([
        'products.findSummaries',
        'audit.prepare',
        'pending.set',
        `visibility.${operation}`,
      ]);
    });

    test('保留中の措置は、記録のIDを採番し投稿者とプロダクトを持つ記録・ライフサイクルの種類・準備した監査ログを運ぶ', async () => {
      const harness = currentHarness();

      await run(harness, operation);

      expect(harness.pendingAtTransition).toHaveLength(1);
      const [taken] = harness.pendingAtTransition;
      expect(harness.preparedEntries).toHaveLength(1);
      const [audit] = harness.preparedEntries;
      if (audit === undefined) {
        throw new Error('監査ログが準備されていません');
      }
      expect(taken).toEqual({
        record: {
          id: ACTION_ID,
          action,
          targetId: PRODUCT_ID,
          subjectUserId: OWNER_ID,
          productId: PRODUCT_ID,
          operatorAdminId: ADMIN_ID,
          reason: REASON,
          noticeStatus,
        },
        lifecycleEvent,
        audit,
        participation: undefined,
      });
      expect(taken?.audit).toBe(audit);
    });

    test('呼び出し側の参加の値を、中身を読まずにそのまま保留中の措置へ渡す', async () => {
      const harness = currentHarness();
      const participation: ModerationWriteParticipation = Object.freeze({
        kind: 'content-reporting.report-resolution',
        payload: Object.freeze({ reportId: '01JQ0RPT000000000000000001' }),
      });

      const outcome = await run(
        harness,
        operation,
        commandOf({ participation }),
      );

      expect(outcome.actionId).toBe(ACTION_ID);
      expect(harness.pendingAtTransition[0]?.participation).toBe(participation);
    });

    test.each([
      ['未入力', undefined],
      ['空', ''],
      ['空白だけ', ' 　\n'],
    ])(
      '理由が%sなら、照会も公開状態の変更もせずに入力の誤りを返す',
      async (_label, reason) => {
        const harness = currentHarness();

        const error = await appErrorOf(
          run(harness, operation, commandOf({ reason })),
        );

        expect(error.kind).toBe('bad_request');
        expect(error.code).toBe('validation_error');
        expect(error.details).toEqual([
          {
            field: 'reason',
            code: 'required',
            message: '理由を入力してください。',
          },
        ]);
        expect(harness.calls).toEqual([]);
      },
    );

    test('理由が500書記素を超えれば入力の誤りを返し、500書記素ちょうどは受け付ける', async () => {
      const tooLong = currentHarness();
      const error = await appErrorOf(
        run(tooLong, operation, commandOf({ reason: '👍🏽'.repeat(501) })),
      );
      expect(error.code).toBe('validation_error');
      expect(error.details).toEqual([
        {
          field: 'reason',
          code: 'too_long',
          message: '理由は500文字以内で入力してください。',
        },
      ]);
      expect(tooLong.calls).toEqual([]);

      const limit = currentHarness();
      const outcome = await run(
        limit,
        operation,
        commandOf({ reason: '👍🏽'.repeat(500) }),
      );
      expect(outcome.changed).toBe(true);
    });

    test('対象のプロダクトが論理削除済み・存在しない(照会に無い)なら、プロダクトが見つからない旨を返し、監査ログも保留中の措置も作らない', async () => {
      const harness = harnessOf({ products: [] });

      const error = await appErrorOf(run(harness, operation));

      expect(error.kind).toBe(MODERATION_ERRORS.product_not_found.kind);
      expect(error.code).toBe('product_not_found');
      expect(error.message).toBe(MODERATION_ERRORS.product_not_found.message);
      expect(harness.calls).toEqual(['products.findSummaries']);
    });

    test('既に同じ状態なら、監査ログも保留中の措置も作らず公開状態の変更も通知もせずに、変化なしを返す', async () => {
      const harness = harnessOf({
        products: [productOf({ hidden: sameHidden })],
      });

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: false, actionId: null });
      expect(harness.calls).toEqual(['products.findSummaries']);
    });

    test('照会の後に同じ状態へ変わり上流が変化なしを返したら、保留中の措置を破棄して変化なしを返し、通知しない', async () => {
      const harness = currentHarness({ visibility: { kind: 'unchanged' } });

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: false, actionId: null });
      expect(harness.calls).toEqual([
        'products.findSummaries',
        'audit.prepare',
        'pending.set',
        `visibility.${operation}`,
        'pending.clear',
      ]);
      expect(
        harness.pending.take({ type: lifecycleEvent, targetId: PRODUCT_ID }),
      ).toBeUndefined();
      expect(harness.reports).toEqual([]);
      expect(harness.dispatched).toEqual([]);
    });

    test('照会の後に論理削除が重なり上流が対象なしを投げたら、プロダクトが見つからない旨を返し、保留中の措置を破棄する', async () => {
      const harness = currentHarness({
        visibility: { kind: 'throw', error: productError('product_not_found') },
      });

      const error = await appErrorOf(run(harness, operation));

      expect(error.kind).toBe(MODERATION_ERRORS.product_not_found.kind);
      expect(error.code).toBe('product_not_found');
      expect(error.message).toBe(MODERATION_ERRORS.product_not_found.message);
      expect(harness.calls.at(-1)).toBe('pending.clear');
      expect(harness.pending.wasTaken()).toBe(false);
      expect(
        harness.pending.take({ type: lifecycleEvent, targetId: PRODUCT_ID }),
      ).toBeUndefined();
      expect(harness.reports).toEqual([]);
      expect(harness.dispatched).toEqual([]);
    });

    test('上流のその他の失敗(参加者の文の違反による取り消しを含む)はそのまま投げ、保留中の措置を破棄する', async () => {
      const failure = new Error('D1の一括の書き込みに失敗しました');
      const harness = currentHarness({
        visibility: { kind: 'throw', error: failure },
      });

      const error = await rejectionOf(run(harness, operation));

      expect(error).toBe(failure);
      expect(harness.calls.at(-1)).toBe('pending.clear');
      expect(harness.reports).toEqual([]);
      expect(harness.dispatched).toEqual([]);
    });

    test('公開状態が変わったのに同期の処理が保留中の措置を取り出さなければ、取り出し漏れを定型の通知へ送り、保留を破棄して成功を返す', async () => {
      const harness = currentHarness({
        visibility: { kind: 'commit', takes: false },
      });

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: true, actionId: null });
      expect(harness.reports).toEqual([
        { incident: 'moderation-record-missing', context: {} },
      ]);
      expect(harness.calls.slice(-2)).toEqual([
        'report:moderation-record-missing',
        'pending.clear',
      ]);
      expect(
        harness.pending.take({ type: lifecycleEvent, targetId: PRODUCT_ID }),
      ).toBeUndefined();
      expect(harness.dispatched).toEqual([]);
      expect(moderationLogs()).toContainEqual({
        level: 'error',
        properties: {
          action,
          productId: PRODUCT_ID,
          operatorAdminId: ADMIN_ID,
        },
      });
    });

    test('ログには措置の種類と識別子と結果だけを出し、プロダクトの名称・ハンドル・理由を出さない', async () => {
      const changed = currentHarness();
      await run(changed, operation);
      const unchanged = harnessOf({
        products: [productOf({ hidden: sameHidden })],
      });
      await run(unchanged, operation);

      expect(moderationLogs()).toEqual([
        {
          level: 'info',
          properties: {
            action,
            actionId: ACTION_ID,
            productId: PRODUCT_ID,
            operatorAdminId: ADMIN_ID,
            result: 'changed',
          },
        },
        {
          level: 'info',
          properties: {
            action,
            actionId: null,
            productId: PRODUCT_ID,
            operatorAdminId: ADMIN_ID,
            result: 'unchanged',
          },
        },
      ]);
      const serialized = JSON.stringify(
        logs.map(({ message, properties }) => ({ message, properties })),
      );
      for (const secret of [PRODUCT_NAME, PRODUCT_HANDLE, REASON]) {
        expect(serialized).not.toContain(secret);
      }
    });
  },
);

describe('DefaultProductModerationService 措置の通知', () => {
  test('非公開化が確定したら、公開状態の変更の後に保留中の措置の記録のIDで非公開化の通知を依頼する', async () => {
    const harness = harnessOf();

    await harness.service.hide(commandOf());

    expect(harness.dispatched).toEqual([ACTION_ID]);
    expect(harness.calls.indexOf('notifier.dispatch')).toBeGreaterThan(
      harness.calls.indexOf('visibility.hide'),
    );
  });

  test('非公開化の通知の依頼が失敗しても措置は成功として返し、警告のログに措置の記録のIDだけを出す', async () => {
    const failure = new Error('メールの送信の依頼に失敗しました');
    const harness = harnessOf({ dispatchError: failure });

    const outcome = await harness.service.hide(commandOf());

    expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
    expect(moderationLogs()).toContainEqual({
      level: 'warning',
      properties: { error: failure, actionId: ACTION_ID },
    });
  });

  test('復元は通知を依頼しない', async () => {
    const harness = harnessOf({ products: [productOf({ hidden: true })] });

    const outcome = await harness.service.unhide(commandOf());

    expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
    expect(harness.dispatched).toEqual([]);
  });
});
