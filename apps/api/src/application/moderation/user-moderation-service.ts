import { inject, injectable } from 'inversify';

import {
  MODERATION_ACTION_DEFINITIONS,
  type ModerationAction,
  type ModerationLifecycleEvent,
} from '../../../common-lib/moderation/moderation-actions.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type {
  AdminUserDirectory,
  AdminUserStatus,
} from '../../../lib/core/identity/ports.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { IDENTITY_TYPES } from '../identity/identity-types.ts';
import type {
  SuspensionResult,
  UserSuspension,
} from '../identity/user-suspension.ts';
import { moderationError } from './moderation-errors.ts';
import type { ModerationNotifier } from './moderation-notifier.ts';
import { normalizeModerationReason } from './moderation-reason.ts';
import { MODERATION_TYPES } from './moderation-types.ts';
import type { PendingModerationRecord } from './pending-moderation-record.ts';
import type {
  ModerationCommand,
  ModerationIncidentReporter,
  ModerationOutcome,
} from './ports.ts';

// 権限の確認は呼び出し側のリゾルバが行う
export interface UserModerationService {
  // 理由の空・上限の超過はAppError(bad_request, validation_error)、退会済み・不在はAppError(not_found, user_not_found)、確定の競合はAppError(conflict, account_state_conflict)
  suspend(command: ModerationCommand): Promise<ModerationOutcome>;
  unsuspend(command: ModerationCommand): Promise<ModerationOutcome>;
}

interface UserTransition {
  readonly action: Extract<ModerationAction, 'user.suspend' | 'user.unsuspend'>;
  readonly lifecycleEvent: Extract<
    ModerationLifecycleEvent,
    'suspended' | 'unsuspended'
  >;
  readonly status: AdminUserStatus;
  readonly run: (userId: string, at: Date) => Promise<SuspensionResult>;
}

interface ModerationLogContext {
  readonly action: ModerationAction;
  readonly userId: string;
  readonly operatorAdminId: string;
}

const NOT_CHANGED: ModerationOutcome = Object.freeze({
  changed: false,
  actionId: null,
});

const logger = getAppLogger(['api', 'application', 'moderation']);

const isAppErrorOf = (error: unknown, code: string): boolean =>
  error instanceof AppError && error.code === code;

const logUnchanged = (context: ModerationLogContext): ModerationOutcome => {
  logger.info('利用者の措置を終えました', {
    ...context,
    actionId: null,
    result: 'unchanged',
  });
  return NOT_CHANGED;
};

@injectable()
export class DefaultUserModerationService implements UserModerationService {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AdminUserDirectory)
    private readonly users: AdminUserDirectory,
    @inject(IDENTITY_TYPES.UserSuspension)
    private readonly suspension: UserSuspension,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(MODERATION_TYPES.PendingModerationRecord)
    private readonly pending: PendingModerationRecord,
    @inject(MODERATION_TYPES.ModerationIncidentReporter)
    private readonly reporter: ModerationIncidentReporter,
    @inject(MODERATION_TYPES.ModerationNotifier)
    private readonly notifier: ModerationNotifier,
  ) {}

  suspend(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'user.suspend',
      lifecycleEvent: 'suspended',
      status: 'suspended',
      run: (userId, at) => this.suspension.suspend(userId, at),
    });
  }

  unsuspend(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'user.unsuspend',
      lifecycleEvent: 'unsuspended',
      status: 'active',
      run: (userId, at) => this.suspension.unsuspend(userId, at),
    });
  }

  async #moderate(
    command: ModerationCommand,
    transition: UserTransition,
  ): Promise<ModerationOutcome> {
    const { action, lifecycleEvent, status, run } = transition;
    const notice = MODERATION_ACTION_DEFINITIONS[action].notice;
    const reason = normalizeModerationReason(action, command.reason);
    const user = (await this.users.findByIds([command.targetId])).get(
      command.targetId,
    );
    if (user === undefined) {
      throw moderationError('user_not_found');
    }
    const { userId } = user;
    const operatorAdminId = command.operator.adminId;
    const logContext: ModerationLogContext = {
      action,
      userId,
      operatorAdminId,
    };
    if (user.status === status) {
      return logUnchanged(logContext);
    }
    const audit = this.auditLog.prepare({
      operatorAdminId,
      action,
      targetIds: [user.pseudonymousId],
      ...(reason === null ? {} : { reason }),
      occurredAt: command.at,
    });
    const actionId = this.ids.generate();
    this.pending.set({
      record: {
        id: actionId,
        action,
        targetId: userId,
        subjectUserId: userId,
        productId: null,
        operatorAdminId,
        reason,
        noticeStatus: notice === 'deferred' ? 'pending' : 'none',
      },
      lifecycleEvent,
      audit,
      participation: command.participation,
    });
    const result = await this.#transit(run, userId, command.at);
    if (result === 'unchanged') {
      this.pending.clear();
      return logUnchanged(logContext);
    }
    if (!this.pending.wasTaken()) {
      // 状態は確定済みのため成功として返す。記録が無いため措置の記録のIDは返さない
      logger.error(
        '利用者の状態は変わりましたが、措置の記録と監査ログが同期の処理で確定されませんでした',
        { ...logContext },
      );
      this.reporter.report('moderation-record-missing', {});
      this.pending.clear();
      return Object.freeze({ changed: true, actionId: null });
    }
    logger.info('利用者の措置を終えました', {
      ...logContext,
      actionId,
      result: 'changed',
    });
    if (notice === 'deferred') {
      await this.#dispatchNotice(actionId);
    }
    return Object.freeze({ changed: true, actionId });
  }

  async #transit(
    run: UserTransition['run'],
    userId: string,
    at: Date,
  ): Promise<SuspensionResult> {
    try {
      return await run(userId, at);
    } catch (error: unknown) {
      this.pending.clear();
      // 上流の競合の文言は利用者本人の操作向けのため、管理画面の文言へ変える。照会の後に退会が重なると上流は対象なしを投げる
      if (isAppErrorOf(error, 'account_state_conflict')) {
        throw moderationError('account_state_conflict');
      }
      if (isAppErrorOf(error, 'not_found')) {
        throw moderationError('user_not_found');
      }
      throw error;
    }
  }

  // 通知の失敗は措置を取り消さない。記録は依頼待ちのまま残り、日次の処理が送り直す
  async #dispatchNotice(actionId: string): Promise<void> {
    try {
      await this.notifier.dispatch(actionId);
    } catch (error: unknown) {
      logger.warning(
        '措置の通知の送信を依頼できませんでした。日次の処理が送り直します',
        { error, actionId },
      );
    }
  }
}
