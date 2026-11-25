import { inject, injectable } from 'inversify';

import {
  MODERATION_ACTION_DEFINITIONS,
  type ModerationAction,
} from '../../../common-lib/moderation/moderation-actions.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type {
  CommentRecord,
  CommentStore,
} from '../../../lib/core/engagement/ports.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { moderationError } from './moderation-errors.ts';
import type { ModerationNotifier } from './moderation-notifier.ts';
import { normalizeModerationReason } from './moderation-reason.ts';
import { MODERATION_TYPES } from './moderation-types.ts';
import type {
  EngagementModerationChange,
  EngagementModerationWrite,
  EngagementModerationWriter,
  ModerationCommand,
  ModerationOutcome,
} from './ports.ts';

// 権限の確認は呼び出し側のリゾルバが行う
export interface CommentModerationService {
  // 理由の空・上限の超過はAppError(bad_request, validation_error)、不在はAppError(not_found, comment_not_found)
  hide(command: ModerationCommand): Promise<ModerationOutcome>;
  // 削除・退会・停止・匿名化に当たるコメントは置き換え表示のまま
  unhide(command: ModerationCommand): Promise<ModerationOutcome>;
}

interface CommentTransition {
  readonly action: Extract<ModerationAction, 'comment.hide' | 'comment.unhide'>;
  readonly hidden: boolean;
  readonly run: (
    write: EngagementModerationWrite,
  ) => Promise<EngagementModerationChange>;
}

interface ModerationLogContext {
  readonly action: ModerationAction;
  readonly commentId: string;
  readonly operatorAdminId: string;
}

const NOT_CHANGED: ModerationOutcome = Object.freeze({
  changed: false,
  actionId: null,
});

const logger = getAppLogger(['api', 'application', 'moderation']);

const logUnchanged = (context: ModerationLogContext): ModerationOutcome => {
  logger.info('コメントの措置を終えました', {
    ...context,
    actionId: null,
    result: 'unchanged',
  });
  return NOT_CHANGED;
};

const isHidden = (comment: CommentRecord): boolean => comment.hiddenAt !== null;

@injectable()
export class DefaultCommentModerationService implements CommentModerationService {
  constructor(
    @inject(ENGAGEMENT_PLATFORM_TYPES.CommentStore)
    private readonly comments: CommentStore,
    @inject(MODERATION_TYPES.EngagementModerationWriter)
    private readonly writer: EngagementModerationWriter,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(MODERATION_TYPES.ModerationNotifier)
    private readonly notifier: ModerationNotifier,
  ) {}

  hide(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'comment.hide',
      hidden: true,
      run: (write) => this.writer.hideComment(write),
    });
  }

  unhide(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'comment.unhide',
      hidden: false,
      run: (write) => this.writer.unhideComment(write),
    });
  }

  async #moderate(
    command: ModerationCommand,
    transition: CommentTransition,
  ): Promise<ModerationOutcome> {
    const { action, hidden, run } = transition;
    const notice = MODERATION_ACTION_DEFINITIONS[action].notice;
    const reason = normalizeModerationReason(action, command.reason);
    const comment = (await this.comments.findByIds([command.targetId])).get(
      command.targetId,
    );
    if (comment === undefined) {
      throw moderationError('comment_not_found');
    }
    const { commentId } = comment;
    const operatorAdminId = command.operator.adminId;
    const logContext: ModerationLogContext = {
      action,
      commentId,
      operatorAdminId,
    };
    if (isHidden(comment) === hidden) {
      return logUnchanged(logContext);
    }
    const audit = this.auditLog.prepare({
      operatorAdminId,
      action,
      targetIds: [commentId],
      ...(reason === null ? {} : { reason }),
      occurredAt: command.at,
    });
    const actionId = this.ids.generate();
    const result = await run({
      targetId: commentId,
      at: command.at,
      record: {
        id: actionId,
        action,
        targetId: commentId,
        subjectUserId: comment.authorUserId,
        productId: comment.productId,
        operatorAdminId,
        reason,
        lifecycleEventId: null,
        occurredAt: command.at,
        noticeStatus: notice === 'deferred' ? 'pending' : 'none',
      },
      audit,
      ...(command.participation === undefined
        ? {}
        : { participation: command.participation }),
    });
    // 上流が変化なしなら記録と監査ログの文も確定されていない
    if (result === 'unchanged') {
      return logUnchanged(logContext);
    }
    logger.info('コメントの措置を終えました', {
      ...logContext,
      actionId,
      result: 'changed',
    });
    if (notice === 'deferred') {
      await this.#dispatchNotice(actionId);
    }
    return Object.freeze({ changed: true, actionId });
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
