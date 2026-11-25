import { inject, injectable } from 'inversify';

import type { ModerationAction } from '../../../common-lib/moderation/moderation-actions.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type {
  AdminRatingDirectory,
  AdminRatingRecord,
} from '../../../lib/core/engagement/ports.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { moderationError } from './moderation-errors.ts';
import { normalizeModerationReason } from './moderation-reason.ts';
import { MODERATION_TYPES } from './moderation-types.ts';
import type {
  EngagementModerationChange,
  EngagementModerationWrite,
  EngagementModerationWriter,
  ModerationCommand,
  ModerationOutcome,
} from './ports.ts';

// 権限の確認は呼び出し側のリゾルバが行う。評価者へは通知しない
export interface RatingModerationService {
  // 理由の空・上限の超過はAppError(bad_request, validation_error)、不在・評価者による取消はAppError(not_found, rating_not_found)
  invalidate(command: ModerationCommand): Promise<ModerationOutcome>;
  revalidate(command: ModerationCommand): Promise<ModerationOutcome>;
}

interface RatingTransition {
  readonly action: Extract<
    ModerationAction,
    'rating.invalidate' | 'rating.revalidate'
  >;
  readonly isAlready: (rating: AdminRatingRecord) => boolean;
  readonly write: (
    write: EngagementModerationWrite,
  ) => Promise<EngagementModerationChange>;
}

interface ModerationLogContext {
  readonly action: ModerationAction;
  readonly ratingId: string;
  readonly operatorAdminId: string;
}

const NOT_CHANGED: ModerationOutcome = Object.freeze({
  changed: false,
  actionId: null,
});

const logger = getAppLogger(['api', 'application', 'moderation']);

const logUnchanged = (context: ModerationLogContext): ModerationOutcome => {
  logger.info('評価の措置を終えました', {
    ...context,
    actionId: null,
    result: 'unchanged',
  });
  return NOT_CHANGED;
};

@injectable()
export class DefaultRatingModerationService implements RatingModerationService {
  constructor(
    @inject(ENGAGEMENT_PLATFORM_TYPES.AdminRatingDirectory)
    private readonly ratings: AdminRatingDirectory,
    @inject(MODERATION_TYPES.EngagementModerationWriter)
    private readonly writer: EngagementModerationWriter,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  invalidate(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'rating.invalidate',
      isAlready: ({ invalidatedAt }) => invalidatedAt !== null,
      write: (write) => this.writer.invalidateRating(write),
    });
  }

  revalidate(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'rating.revalidate',
      isAlready: ({ invalidatedAt }) => invalidatedAt === null,
      write: (write) => this.writer.revalidateRating(write),
    });
  }

  async #moderate(
    command: ModerationCommand,
    transition: RatingTransition,
  ): Promise<ModerationOutcome> {
    const { action, isAlready, write } = transition;
    const reason = normalizeModerationReason(action, command.reason);
    const rating = (await this.ratings.findByIds([command.targetId])).get(
      command.targetId,
    );
    if (rating === undefined) {
      throw moderationError('rating_not_found');
    }
    const { ratingId } = rating;
    const operatorAdminId = command.operator.adminId;
    const logContext: ModerationLogContext = {
      action,
      ratingId,
      operatorAdminId,
    };
    if (isAlready(rating)) {
      return logUnchanged(logContext);
    }
    const audit = this.auditLog.prepare({
      operatorAdminId,
      action,
      targetIds: [ratingId],
      ...(reason === null ? {} : { reason }),
      occurredAt: command.at,
    });
    const actionId = this.ids.generate();
    const result = await write({
      record: {
        id: actionId,
        action,
        targetId: ratingId,
        subjectUserId: rating.userId,
        productId: rating.productId,
        operatorAdminId,
        reason,
        lifecycleEventId: null,
        occurredAt: command.at,
        noticeStatus: 'none',
      },
      audit,
      targetId: ratingId,
      at: command.at,
      participation: command.participation,
    });
    // 書き込みの単位は変化が無ければ記録と監査ログの文も確定しないため、記録のIDを返さない
    if (result === 'unchanged') {
      return logUnchanged(logContext);
    }
    logger.info('評価の措置を終えました', {
      ...logContext,
      actionId,
      result: 'changed',
    });
    return Object.freeze({ changed: true, actionId });
  }
}
