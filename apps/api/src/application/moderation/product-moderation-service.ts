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
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import type {
  ProductVisibilityControl,
  VisibilityChangeResult,
} from '../product/product-visibility-control.ts';
import { PRODUCT_TYPES } from '../product/product-types.ts';
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
export interface ProductModerationService {
  // 理由の空・上限の超過はAppError(bad_request, validation_error)、論理削除済み・不在はAppError(not_found, product_not_found)
  hide(command: ModerationCommand): Promise<ModerationOutcome>;
  // 非公開化で取り消したローンチは戻さない
  unhide(command: ModerationCommand): Promise<ModerationOutcome>;
}

interface ProductTransition {
  readonly action: Extract<ModerationAction, 'product.hide' | 'product.unhide'>;
  readonly lifecycleEvent: Extract<
    ModerationLifecycleEvent,
    'hidden' | 'unhidden'
  >;
  readonly hidden: boolean;
  readonly run: (
    productId: string,
    at: Date,
  ) => Promise<VisibilityChangeResult>;
}

interface ModerationLogContext {
  readonly action: ModerationAction;
  readonly productId: string;
  readonly operatorAdminId: string;
}

const NOT_CHANGED: ModerationOutcome = Object.freeze({
  changed: false,
  actionId: null,
});

const logger = getAppLogger(['api', 'application', 'moderation']);

const logUnchanged = (context: ModerationLogContext): ModerationOutcome => {
  logger.info('プロダクトの措置を終えました', {
    ...context,
    actionId: null,
    result: 'unchanged',
  });
  return NOT_CHANGED;
};

@injectable()
export class DefaultProductModerationService implements ProductModerationService {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(PRODUCT_TYPES.ProductVisibilityControl)
    private readonly visibility: ProductVisibilityControl,
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

  hide(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'product.hide',
      lifecycleEvent: 'hidden',
      hidden: true,
      run: (productId, at) => this.visibility.hide(productId, at),
    });
  }

  unhide(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'product.unhide',
      lifecycleEvent: 'unhidden',
      hidden: false,
      run: (productId, at) => this.visibility.unhide(productId, at),
    });
  }

  async #moderate(
    command: ModerationCommand,
    transition: ProductTransition,
  ): Promise<ModerationOutcome> {
    const { action, lifecycleEvent, hidden, run } = transition;
    const notice = MODERATION_ACTION_DEFINITIONS[action].notice;
    const reason = normalizeModerationReason(action, command.reason);
    const product = (
      await this.products.findSummaries([command.targetId], 'not-deleted')
    ).get(command.targetId);
    if (product === undefined) {
      throw moderationError('product_not_found');
    }
    const { productId, ownerUserId } = product;
    const operatorAdminId = command.operator.adminId;
    const logContext: ModerationLogContext = {
      action,
      productId,
      operatorAdminId,
    };
    if (product.hidden === hidden) {
      return logUnchanged(logContext);
    }
    const audit = this.auditLog.prepare({
      operatorAdminId,
      action,
      targetIds: [productId],
      ...(reason === null ? {} : { reason }),
      occurredAt: command.at,
    });
    const actionId = this.ids.generate();
    this.pending.set({
      record: {
        id: actionId,
        action,
        targetId: productId,
        subjectUserId: ownerUserId,
        productId,
        operatorAdminId,
        reason,
        noticeStatus: notice === 'deferred' ? 'pending' : 'none',
      },
      lifecycleEvent,
      audit,
      participation: command.participation,
    });
    const result = await this.#transit(run, productId, command.at);
    if (result === 'unchanged') {
      this.pending.clear();
      return logUnchanged(logContext);
    }
    if (!this.pending.wasTaken()) {
      // 状態は確定済みのため成功として返す。記録が無いため措置の記録のIDは返さない
      logger.error(
        'プロダクトの公開状態は変わりましたが、措置の記録と監査ログが同期の処理で確定されませんでした',
        { ...logContext },
      );
      this.reporter.report('moderation-record-missing', {});
      this.pending.clear();
      return Object.freeze({ changed: true, actionId: null });
    }
    logger.info('プロダクトの措置を終えました', {
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
    run: ProductTransition['run'],
    productId: string,
    at: Date,
  ): Promise<VisibilityChangeResult> {
    try {
      return await run(productId, at);
    } catch (error: unknown) {
      this.pending.clear();
      // 照会の後に論理削除が重なると上流は対象なしを投げる
      if (error instanceof AppError && error.code === 'product_not_found') {
        throw moderationError('product_not_found');
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
