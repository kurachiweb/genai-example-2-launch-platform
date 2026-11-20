import { inject, injectable } from 'inversify';

import type { ModerationAction } from '../../../common-lib/moderation/moderation-actions.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { AdminUserDirectory } from '../../../lib/core/identity/ports.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { Principal } from '../../../lib/core/session/session-view.ts';
import type { AdministrativeWithdrawal } from '../identity/administrative-withdrawal.ts';
import { IDENTITY_TYPES } from '../identity/identity-types.ts';
import { moderationError } from './moderation-errors.ts';
import { normalizeModerationReason } from './moderation-reason.ts';
import { MODERATION_TYPES } from './moderation-types.ts';
import type { PendingModerationRecord } from './pending-moderation-record.ts';
import type {
  ModerationIncidentReporter,
  ModerationOperator,
  ModerationOutcome,
} from './ports.ts';

export interface AdministrativeWithdrawalCommandInput {
  readonly userId: string;
  readonly reason: string | undefined;
  readonly operator: ModerationOperator;
  // GraphQLContext.caller
  readonly caller: string;
  // GraphQLContext.session.principal()の結果
  readonly principal: Principal;
  readonly at: Date;
}

// 最上位管理者の権限の確認は呼び出し側のリゾルバが行う。本人の意思の確かめと完了の知らせはシステムの外のメールで行うため、利用者へメールを送らない
export interface AdministrativeWithdrawalService {
  // 理由の空・上限の超過はAppError(bad_request, validation_error)、退会済み・不在はAppError(not_found, user_not_found)、確定の競合はAppError(conflict, account_state_conflict)
  withdraw(
    input: AdministrativeWithdrawalCommandInput,
  ): Promise<ModerationOutcome>;
}

const ACTION = 'user.administrative-withdraw' satisfies ModerationAction;

const logger = getAppLogger(['api', 'application', 'moderation']);

const isAppErrorOf = (error: unknown, code: string): boolean =>
  error instanceof AppError && error.code === code;

@injectable()
export class DefaultAdministrativeWithdrawalService implements AdministrativeWithdrawalService {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AdminUserDirectory)
    private readonly users: AdminUserDirectory,
    @inject(IDENTITY_TYPES.AdministrativeWithdrawal)
    private readonly withdrawal: AdministrativeWithdrawal,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(MODERATION_TYPES.PendingModerationRecord)
    private readonly pending: PendingModerationRecord,
    @inject(MODERATION_TYPES.ModerationIncidentReporter)
    private readonly reporter: ModerationIncidentReporter,
  ) {}

  async withdraw(
    input: AdministrativeWithdrawalCommandInput,
  ): Promise<ModerationOutcome> {
    const reason = normalizeModerationReason(ACTION, input.reason);
    const user = (await this.users.findByIds([input.userId])).get(input.userId);
    if (user === undefined) {
      throw moderationError('user_not_found');
    }
    const { userId } = user;
    const operatorAdminId = input.operator.adminId;
    const logContext = { action: ACTION, userId, operatorAdminId };
    const audit = this.auditLog.prepare({
      operatorAdminId,
      action: ACTION,
      targetIds: [user.pseudonymousId],
      ...(reason === null ? {} : { reason }),
      occurredAt: input.at,
    });
    const actionId = this.ids.generate();
    this.pending.set({
      record: {
        id: actionId,
        action: ACTION,
        targetId: userId,
        subjectUserId: userId,
        productId: null,
        operatorAdminId,
        reason,
        noticeStatus: 'none',
      },
      lifecycleEvent: 'withdrawn',
      audit,
      participation: undefined,
    });
    await this.#commit({ ...input, userId });
    if (!this.pending.wasTaken()) {
      // 退会は確定済みのため成功として返す。記録が無いため措置の記録のIDは返さない
      logger.error(
        '利用者は退会しましたが、措置の記録と監査ログが同期の処理で確定されませんでした',
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
    return Object.freeze({ changed: true, actionId });
  }

  async #commit(input: AdministrativeWithdrawalCommandInput): Promise<void> {
    try {
      await this.withdrawal.withdraw({
        userId: input.userId,
        caller: input.caller,
        operator: input.principal,
        at: input.at,
      });
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
}
