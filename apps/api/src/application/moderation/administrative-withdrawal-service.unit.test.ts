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
import type { Principal } from '../../../lib/core/session/session-view.ts';
import type {
  AdministrativeWithdrawal,
  AdministrativeWithdrawalCommand,
} from '../identity/administrative-withdrawal.ts';
import { identityError } from '../identity/identity-errors.ts';
import {
  type AdministrativeWithdrawalCommandInput,
  type AdministrativeWithdrawalService,
  DefaultAdministrativeWithdrawalService,
} from './administrative-withdrawal-service.ts';
import { MODERATION_ERRORS } from './moderation-errors.ts';
import {
  InMemoryPendingModerationRecord,
  type PendingModeration,
} from './pending-moderation-record.ts';
import type {
  ModerationIncident,
  ModerationIncidentContext,
  ModerationIncidentReporter,
} from './ports.ts';

const AT = new Date('2026-11-20T03:00:00.000Z');
const USER_ID = '01JQ0USR000000000000000001';
const PSEUDONYMOUS_ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const ADMIN_ID = '01JQ0ADM000000000000000001';
const ACTION_ID = '01JQ0MDR000000000000000001';
const HANDLE = 'secret_handle';
const NICKNAME = '秘密のニックネーム';
const REASON = '本人から問い合わせのメールで退会の依頼を受けたため';
const ACTION = 'user.administrative-withdraw';

const PRINCIPAL: Principal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: ADMIN_ID,
  sessionId: '01JQ0SESSION00000000000001',
});

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

const inputOf = (
  overrides: Partial<AdministrativeWithdrawalCommandInput> = {},
): AdministrativeWithdrawalCommandInput => ({
  userId: USER_ID,
  reason: `  ${REASON}\n`,
  operator: { adminId: ADMIN_ID },
  caller: 'admin',
  principal: PRINCIPAL,
  at: AT,
  ...overrides,
});

type WithdrawalBehavior =
  | { readonly kind: 'commit'; readonly takes: boolean }
  | { readonly kind: 'throw'; readonly error: Error };

interface HarnessOptions {
  readonly users?: readonly AdminUserRecord[];
  readonly withdrawal?: WithdrawalBehavior;
}

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
  const withdrawals: AdministrativeWithdrawalCommand[] = [];
  const pendingAtWithdrawal: (PendingModeration | undefined)[] = [];
  const reports: {
    incident: ModerationIncident;
    context: ModerationIncidentContext;
  }[] = [];
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
  const withdrawal: AdministrativeWithdrawal = {
    withdraw: (command) => {
      calls.push('withdrawal.withdraw');
      withdrawals.push(command);
      const behavior = options.withdrawal ?? { kind: 'commit', takes: true };
      if (behavior.kind === 'throw') {
        return Promise.reject(behavior.error);
      }
      if (behavior.takes) {
        pendingAtWithdrawal.push(
          pending.take({ type: 'withdrawn', targetId: command.userId }),
        );
      }
      return Promise.resolve();
    },
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
  const service: AdministrativeWithdrawalService =
    new DefaultAdministrativeWithdrawalService(
      users,
      withdrawal,
      auditLog,
      { generate: () => ACTION_ID },
      pending,
      reporter,
    );
  return {
    service,
    pending,
    calls,
    lookups,
    prepared,
    preparedEntries,
    withdrawals,
    pendingAtWithdrawal,
    reports,
  };
};

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

describe('DefaultAdministrativeWithdrawalService 代理の退会', () => {
  test('前後の空白を除いた理由で、仮名化IDを対象にした詳細の無い監査ログを準備し、保留中の措置を置いてから管理者の主体で退会させる', async () => {
    const harness = harnessOf();

    const outcome = await harness.service.withdraw(inputOf());

    expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
    expect(harness.lookups).toEqual([[USER_ID]]);
    expect(harness.prepared).toEqual([
      {
        operatorAdminId: ADMIN_ID,
        action: ACTION,
        targetIds: [PSEUDONYMOUS_ID],
        reason: REASON,
        occurredAt: AT,
      },
    ]);
    expect(harness.withdrawals).toEqual([
      { userId: USER_ID, caller: 'admin', operator: PRINCIPAL, at: AT },
    ]);
    expect(harness.withdrawals[0]?.operator).toBe(PRINCIPAL);
    expect(harness.calls).toEqual([
      'users.findByIds',
      'audit.prepare',
      'pending.set',
      'withdrawal.withdraw',
    ]);
  });

  test('保留中の措置は、記録のIDを採番した通知の状態が送らないの記録・退会のイベント・準備した監査ログを運び、参加の値を持たない', async () => {
    const harness = harnessOf();

    await harness.service.withdraw(inputOf());

    expect(harness.pendingAtWithdrawal).toHaveLength(1);
    const [taken] = harness.pendingAtWithdrawal;
    const [audit] = harness.preparedEntries;
    if (audit === undefined) {
      throw new Error('監査ログが準備されていません');
    }
    expect(taken).toEqual({
      record: {
        id: ACTION_ID,
        action: ACTION,
        targetId: USER_ID,
        subjectUserId: USER_ID,
        productId: null,
        operatorAdminId: ADMIN_ID,
        reason: REASON,
        noticeStatus: 'none',
      },
      lifecycleEvent: 'withdrawn',
      audit,
      participation: undefined,
    });
    expect(taken?.audit).toBe(audit);
  });

  test('停止中の利用者も退会させる', async () => {
    const harness = harnessOf({
      users: [
        userOf({
          status: 'suspended',
          suspendedAt: new Date('2026-11-19T00:00:00.000Z'),
        }),
      ],
    });

    const outcome = await harness.service.withdraw(inputOf());

    expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
    expect(harness.withdrawals.map(({ userId }) => userId)).toEqual([USER_ID]);
  });

  test('退会が確定しても、退会の確定のほかに利用者へメールを送る処理を呼ばない', async () => {
    const harness = harnessOf();

    await harness.service.withdraw(inputOf());

    expect(harness.calls).not.toContain('notifier.dispatch');
    expect(harness.calls.at(-1)).toBe('withdrawal.withdraw');
    expect(harness.pendingAtWithdrawal[0]?.record.noticeStatus).toBe('none');
    expect(harness.reports).toEqual([]);
  });

  test.each([
    ['未入力', undefined],
    ['空', ''],
    ['空白だけ', ' 　\n'],
  ])(
    '理由が%sなら、照会も退会もせずに入力の誤りを返す',
    async (_label, reason) => {
      const harness = harnessOf();

      const error = await appErrorOf(
        harness.service.withdraw(inputOf({ reason })),
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
    const tooLong = harnessOf();
    const error = await appErrorOf(
      tooLong.service.withdraw(inputOf({ reason: '👍🏽'.repeat(501) })),
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

    const limit = harnessOf();
    const outcome = await limit.service.withdraw(
      inputOf({ reason: '👍🏽'.repeat(500) }),
    );
    expect(outcome.changed).toBe(true);
  });

  test('対象の利用者が退会済み・存在しない(照会に無い)なら、利用者が見つからない旨を返し、監査ログも保留中の措置も作らず退会させない', async () => {
    const harness = harnessOf({ users: [] });

    const error = await appErrorOf(harness.service.withdraw(inputOf()));

    expect(error.kind).toBe(MODERATION_ERRORS.user_not_found.kind);
    expect(error.code).toBe('user_not_found');
    expect(error.message).toBe(MODERATION_ERRORS.user_not_found.message);
    expect(harness.calls).toEqual(['users.findByIds']);
  });

  test('照会の後に退会が重なり上流が対象なしを投げたら、利用者が見つからない旨へ変えて返し、保留中の措置を破棄する', async () => {
    const harness = harnessOf({
      withdrawal: { kind: 'throw', error: identityError('not_found') },
    });

    const error = await appErrorOf(harness.service.withdraw(inputOf()));

    expect(error.code).toBe('user_not_found');
    expect(error.message).toBe(MODERATION_ERRORS.user_not_found.message);
    expect(harness.calls.at(-1)).toBe('pending.clear');
    expect(
      harness.pending.take({ type: 'withdrawn', targetId: USER_ID }),
    ).toBeUndefined();
  });

  test('同じ利用者の状態の同時の変更で確定が競合したら、最新の状態の読み直しを案内する本specの文言の競合を返し、保留中の措置を破棄する', async () => {
    const harness = harnessOf({
      withdrawal: {
        kind: 'throw',
        error: identityError('account_state_conflict'),
      },
    });

    const error = await appErrorOf(harness.service.withdraw(inputOf()));

    expect(error.kind).toBe('conflict');
    expect(error.code).toBe('account_state_conflict');
    expect(error.message).toBe(
      MODERATION_ERRORS.account_state_conflict.message,
    );
    expect(harness.calls.at(-1)).toBe('pending.clear');
    expect(harness.pending.wasTaken()).toBe(false);
    expect(
      harness.pending.take({ type: 'withdrawn', targetId: USER_ID }),
    ).toBeUndefined();
    expect(harness.reports).toEqual([]);
  });

  test('上流のその他の失敗(管理者側でない呼び出し元の拒否を含む)はそのまま投げ、保留中の措置を破棄する', async () => {
    const forbidden = identityError('forbidden');
    const failure = new Error('D1の一括の書き込みに失敗しました');
    for (const thrown of [forbidden, failure]) {
      const harness = harnessOf({
        withdrawal: { kind: 'throw', error: thrown },
      });

      const error = await rejectionOf(harness.service.withdraw(inputOf()));

      expect(error).toBe(thrown);
      expect(harness.calls.at(-1)).toBe('pending.clear');
      expect(harness.reports).toEqual([]);
    }
  });

  test('退会したのに同期の処理が保留中の措置を取り出さなければ、取り出し漏れを定型の通知へ送り、保留を破棄して記録のIDを持たない成功を返す', async () => {
    const harness = harnessOf({
      withdrawal: { kind: 'commit', takes: false },
    });

    const outcome = await harness.service.withdraw(inputOf());

    expect(outcome).toEqual({ changed: true, actionId: null });
    expect(harness.reports).toEqual([
      { incident: 'moderation-record-missing', context: {} },
    ]);
    expect(harness.calls.slice(-2)).toEqual([
      'report:moderation-record-missing',
      'pending.clear',
    ]);
    expect(
      harness.pending.take({ type: 'withdrawn', targetId: USER_ID }),
    ).toBeUndefined();
    expect(moderationLogs()).toContainEqual({
      level: 'error',
      properties: {
        action: ACTION,
        userId: USER_ID,
        operatorAdminId: ADMIN_ID,
      },
    });
  });

  test('ログには措置の種類と識別子と結果だけを出し、ハンドル・ニックネーム・理由・仮名化IDを出さない', async () => {
    const harness = harnessOf();

    await harness.service.withdraw(inputOf());

    expect(moderationLogs()).toEqual([
      {
        level: 'info',
        properties: {
          action: ACTION,
          actionId: ACTION_ID,
          userId: USER_ID,
          operatorAdminId: ADMIN_ID,
          result: 'changed',
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
});
