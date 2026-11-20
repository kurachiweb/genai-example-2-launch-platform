import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  AdminUserDirectory,
  AdminUserRecord,
} from '../../../lib/core/identity/ports.ts';
import { identityError } from '../identity/identity-errors.ts';
import type {
  SuspensionResult,
  UserSuspension,
} from '../identity/user-suspension.ts';
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
  DefaultUserModerationService,
  type UserModerationService,
} from './user-moderation-service.ts';

const AT = new Date('2026-11-20T03:00:00.000Z');
const USER_ID = '01JQ0USR000000000000000001';
const PSEUDONYMOUS_ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const ADMIN_ID = '01JQ0ADM000000000000000001';
const ACTION_ID = '01JQ0MDR000000000000000001';
const HANDLE = 'secret_handle';
const NICKNAME = '秘密のニックネーム';
const REASON = '規約違反の投稿を繰り返したため';

type Operation = 'suspend' | 'unsuspend';

const OPERATIONS = [
  {
    operation: 'suspend',
    label: '停止',
    action: 'user.suspend',
    lifecycleEvent: 'suspended',
    noticeStatus: 'pending',
    currentStatus: 'active',
    sameStatus: 'suspended',
  },
  {
    operation: 'unsuspend',
    label: '停止解除',
    action: 'user.unsuspend',
    lifecycleEvent: 'unsuspended',
    noticeStatus: 'none',
    currentStatus: 'suspended',
    sameStatus: 'active',
  },
] as const;

const userOf = (overrides: Partial<AdminUserRecord> = {}): AdminUserRecord => ({
  userId: USER_ID,
  pseudonymousId: PSEUDONYMOUS_ID,
  handle: HANDLE,
  nickname: NICKNAME,
  status: 'active',
  suspendedAt: null,
  registeredAt: new Date('2026-01-01T00:00:00.000Z'),
  emailVerified: true,
  disposableEmailStatus: 'regular',
  ...overrides,
});

const commandOf = (
  overrides: Partial<ModerationCommand> = {},
): ModerationCommand => ({
  targetId: USER_ID,
  reason: `  ${REASON}\n`,
  operator: { adminId: ADMIN_ID },
  at: AT,
  ...overrides,
});

type SuspensionBehavior =
  | { readonly kind: 'commit'; readonly takes: boolean }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'throw'; readonly error: Error };

interface HarnessOptions {
  readonly users?: readonly AdminUserRecord[];
  readonly suspension?: SuspensionBehavior;
  readonly dispatchError?: Error;
}

const COMMIT_AND_TAKE: SuspensionBehavior = { kind: 'commit', takes: true };

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
  const lookups: (readonly string[])[] = [];
  const prepared: AuditEntryInput[] = [];
  const preparedEntries: PreparedAuditEntry[] = [];
  const transitions: { operation: Operation; userId: string; at: Date }[] = [];
  const pendingAtTransition: (PendingModeration | undefined)[] = [];
  const reports: {
    incident: ModerationIncident;
    context: ModerationIncidentContext;
  }[] = [];
  const dispatched: string[] = [];
  const pending = new RecordingPendingModerationRecord(calls);
  const users: AdminUserDirectory = {
    search: () => Promise.reject(new Error('一覧の検索は呼ばれない想定です')),
    findByIds: (userIds) => {
      calls.push('users.findByIds');
      lookups.push(userIds);
      const found = (options.users ?? [userOf()]).filter(({ userId }) =>
        userIds.includes(userId),
      );
      return Promise.resolve(new Map(found.map((user) => [user.userId, user])));
    },
    findByEmail: () =>
      Promise.reject(new Error('メールアドレスの照会は呼ばれない想定です')),
    countRegisteredAt: () =>
      Promise.reject(new Error('登録数の集計は呼ばれない想定です')),
  };
  // 同期の処理は確定の一括の書き込みを組み立てるときに保留中の措置を取り出すため、偽物の確定でも同じ時機に取り出す
  const transit = (
    operation: Operation,
    lifecycleEvent: string,
    userId: string,
    at: Date,
  ): Promise<SuspensionResult> => {
    calls.push(`suspension.${operation}`);
    transitions.push({ operation, userId, at });
    const behavior = options.suspension ?? COMMIT_AND_TAKE;
    if (behavior.kind === 'throw') {
      return Promise.reject(behavior.error);
    }
    if (behavior.kind === 'unchanged') {
      return Promise.resolve('unchanged');
    }
    if (behavior.takes) {
      pendingAtTransition.push(
        pending.take({ type: lifecycleEvent, targetId: userId }),
      );
    }
    return Promise.resolve('changed');
  };
  const suspension: UserSuspension = {
    suspend: (userId, at) => transit('suspend', 'suspended', userId, at),
    unsuspend: (userId, at) => transit('unsuspend', 'unsuspended', userId, at),
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
        targetKind: 'user',
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
  const service: UserModerationService = new DefaultUserModerationService(
    users,
    suspension,
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
  'DefaultUserModerationService $label',
  ({
    operation,
    action,
    lifecycleEvent,
    noticeStatus,
    currentStatus,
    sameStatus,
  }) => {
    const activeHarness = (options: HarnessOptions = {}) =>
      harnessOf({ users: [userOf({ status: currentStatus })], ...options });

    test('前後の空白を除いた理由で、仮名化IDを対象にした監査ログを準備し、保留中の措置を置いてから状態を変える', async () => {
      const harness = activeHarness();

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
      expect(harness.lookups).toEqual([[USER_ID]]);
      expect(harness.prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action,
          targetIds: [PSEUDONYMOUS_ID],
          reason: REASON,
          occurredAt: AT,
        },
      ]);
      expect(harness.transitions).toEqual([
        { operation, userId: USER_ID, at: AT },
      ]);
      expect(harness.calls.slice(0, 4)).toEqual([
        'users.findByIds',
        'audit.prepare',
        'pending.set',
        `suspension.${operation}`,
      ]);
    });

    test('保留中の措置は、記録のIDを採番した利用者の記録・ライフサイクルの種類・準備した監査ログを運ぶ', async () => {
      const harness = activeHarness();

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
          targetId: USER_ID,
          subjectUserId: USER_ID,
          productId: null,
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
      const harness = activeHarness();
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
      '理由が%sなら、照会も状態の変更もせずに入力の誤りを返す',
      async (_label, reason) => {
        const harness = activeHarness();

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
      const tooLong = activeHarness();
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

      const limit = activeHarness();
      const outcome = await run(
        limit,
        operation,
        commandOf({ reason: '👍🏽'.repeat(500) }),
      );
      expect(outcome.changed).toBe(true);
    });

    test('対象の利用者が退会済み・存在しない(照会に無い)なら、利用者が見つからない旨を返し、監査ログも保留中の措置も作らない', async () => {
      const harness = harnessOf({ users: [] });

      const error = await appErrorOf(run(harness, operation));

      expect(error.kind).toBe(MODERATION_ERRORS.user_not_found.kind);
      expect(error.code).toBe('user_not_found');
      expect(error.message).toBe(MODERATION_ERRORS.user_not_found.message);
      expect(harness.calls).toEqual(['users.findByIds']);
    });

    test('既に同じ状態なら、監査ログも保留中の措置も作らず状態の変更も通知もせずに、変化なしを返す', async () => {
      const harness = harnessOf({ users: [userOf({ status: sameStatus })] });

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: false, actionId: null });
      expect(harness.calls).toEqual(['users.findByIds']);
    });

    test('照会の後に同じ状態へ変わり上流が変化なしを返したら、保留中の措置を破棄して変化なしを返し、通知しない', async () => {
      const harness = activeHarness({ suspension: { kind: 'unchanged' } });

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: false, actionId: null });
      expect(harness.calls).toEqual([
        'users.findByIds',
        'audit.prepare',
        'pending.set',
        `suspension.${operation}`,
        'pending.clear',
      ]);
      expect(
        harness.pending.take({ type: lifecycleEvent, targetId: USER_ID }),
      ).toBeUndefined();
      expect(harness.reports).toEqual([]);
      expect(harness.dispatched).toEqual([]);
    });

    test('同じ利用者の状態の同時の変更で確定が競合したら、本specの文言の競合を返し、保留中の措置を破棄する', async () => {
      const harness = activeHarness({
        suspension: {
          kind: 'throw',
          error: identityError('account_state_conflict'),
        },
      });

      const error = await appErrorOf(run(harness, operation));

      expect(error.kind).toBe('conflict');
      expect(error.code).toBe('account_state_conflict');
      expect(error.message).toBe(
        MODERATION_ERRORS.account_state_conflict.message,
      );
      expect(harness.calls.at(-1)).toBe('pending.clear');
      expect(harness.pending.wasTaken()).toBe(false);
      expect(
        harness.pending.take({ type: lifecycleEvent, targetId: USER_ID }),
      ).toBeUndefined();
      expect(harness.reports).toEqual([]);
      expect(harness.dispatched).toEqual([]);
    });

    test('照会の後に退会が重なり上流が対象なしを投げたら、利用者が見つからない旨へ変えて返し、保留中の措置を破棄する', async () => {
      const harness = activeHarness({
        suspension: { kind: 'throw', error: identityError('not_found') },
      });

      const error = await appErrorOf(run(harness, operation));

      expect(error.code).toBe('user_not_found');
      expect(error.message).toBe(MODERATION_ERRORS.user_not_found.message);
      expect(harness.calls.at(-1)).toBe('pending.clear');
      expect(harness.dispatched).toEqual([]);
    });

    test('上流のその他の失敗はそのまま投げ、保留中の措置を破棄する', async () => {
      const failure = new Error('D1の一括の書き込みに失敗しました');
      const harness = activeHarness({
        suspension: { kind: 'throw', error: failure },
      });

      const error = await rejectionOf(run(harness, operation));

      expect(error).toBe(failure);
      expect(harness.calls.at(-1)).toBe('pending.clear');
      expect(harness.reports).toEqual([]);
      expect(harness.dispatched).toEqual([]);
    });

    test('状態が変わったのに同期の処理が保留中の措置を取り出さなければ、取り出し漏れを定型の通知へ送り、保留を破棄して成功を返す', async () => {
      const harness = activeHarness({
        suspension: { kind: 'commit', takes: false },
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
        harness.pending.take({ type: lifecycleEvent, targetId: USER_ID }),
      ).toBeUndefined();
      expect(harness.dispatched).toEqual([]);
      expect(moderationLogs()).toContainEqual({
        level: 'error',
        properties: { action, userId: USER_ID, operatorAdminId: ADMIN_ID },
      });
    });

    test('ログには措置の種類と識別子と結果だけを出し、ハンドル・ニックネーム・理由を出さない', async () => {
      const changed = activeHarness();
      await run(changed, operation);
      const unchanged = harnessOf({ users: [userOf({ status: sameStatus })] });
      await run(unchanged, operation);

      expect(moderationLogs()).toEqual([
        {
          level: 'info',
          properties: {
            action,
            actionId: ACTION_ID,
            userId: USER_ID,
            operatorAdminId: ADMIN_ID,
            result: 'changed',
          },
        },
        {
          level: 'info',
          properties: {
            action,
            actionId: null,
            userId: USER_ID,
            operatorAdminId: ADMIN_ID,
            result: 'unchanged',
          },
        },
      ]);
      const serialized = JSON.stringify(
        logs.map(({ message, properties }) => ({ message, properties })),
      );
      for (const secret of [HANDLE, NICKNAME, REASON, PSEUDONYMOUS_ID]) {
        expect(serialized).not.toContain(secret);
      }
    });
  },
);

describe('DefaultUserModerationService 措置の通知', () => {
  test('停止が確定したら、保留中の措置の記録のIDで停止の通知を依頼する', async () => {
    const harness = harnessOf();

    await harness.service.suspend(commandOf());

    expect(harness.dispatched).toEqual([ACTION_ID]);
    expect(harness.calls.indexOf('notifier.dispatch')).toBeGreaterThan(
      harness.calls.indexOf('suspension.suspend'),
    );
  });

  test('停止の通知の依頼が失敗しても措置は成功として返し、警告のログに措置の記録のIDだけを出す', async () => {
    const failure = new Error('メールの送信の依頼に失敗しました');
    const harness = harnessOf({ dispatchError: failure });

    const outcome = await harness.service.suspend(commandOf());

    expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
    expect(moderationLogs()).toContainEqual({
      level: 'warning',
      properties: { error: failure, actionId: ACTION_ID },
    });
  });

  test('停止解除は通知を依頼しない', async () => {
    const harness = harnessOf({ users: [userOf({ status: 'suspended' })] });

    const outcome = await harness.service.unsuspend(commandOf());

    expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
    expect(harness.dispatched).toEqual([]);
  });
});
