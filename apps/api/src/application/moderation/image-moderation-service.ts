import { inject, injectable } from 'inversify';

import type { ModerationAction } from '../../../common-lib/moderation/moderation-actions.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type {
  MediaFileView,
  MediaOwner,
} from '../../../lib/core/media/media-file.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import { moderationError } from './moderation-errors.ts';
import { normalizeModerationReason } from './moderation-reason.ts';
import { MODERATION_TYPES } from './moderation-types.ts';
import type {
  ImageModerationChange,
  ImageModerationWrite,
  ImageModerationWriter,
  ModerationCommand,
  ModerationOutcome,
} from './ports.ts';

// 権限の確認は呼び出し側のリゾルバが行う。画像の操作は投稿者へ通知しない
export interface ImageModerationService {
  // 理由の上限の超過はAppError(bad_request, validation_error)、不在・画像用でない用途・削除待ちはAppError(not_found, image_not_found)、自動判定の理由が無ければAppError(unprocessable, image_action_not_applicable)
  approve(command: ModerationCommand): Promise<ModerationOutcome>;
  // 不在・画像用でない用途・削除待ちはAppError(not_found, image_not_found)
  quarantine(command: ModerationCommand): Promise<ModerationOutcome>;
  // 不在・画像用でない用途・削除待ちはAppError(not_found, image_not_found)、管理者操作の理由が無ければAppError(unprocessable, image_action_not_applicable)
  release(command: ModerationCommand): Promise<ModerationOutcome>;
  // 不在・画像用でない用途はAppError(not_found, image_not_found)、削除待ちは変化なし、隔離理由が無ければAppError(unprocessable, image_action_not_applicable)
  remove(command: ModerationCommand): Promise<ModerationOutcome>;
}

type ImageAction = Extract<
  ModerationAction,
  'image.approve' | 'image.quarantine' | 'image.release' | 'image.delete'
>;

interface ImageTransition {
  readonly action: ImageAction;
  readonly applicable: (file: MediaFileView) => boolean;
  readonly write: (
    write: ImageModerationWrite,
  ) => Promise<ImageModerationChange>;
}

interface ModerationLogContext {
  readonly action: ImageAction;
  readonly fileId: string;
  readonly operatorAdminId: string;
}

const NOT_CHANGED: ModerationOutcome = Object.freeze({
  changed: false,
  actionId: null,
});

const logger = getAppLogger(['api', 'application', 'moderation']);

const subjectUserIdOf = (owner: MediaOwner): string | null =>
  owner.kind === 'user' ? owner.id : null;

const logOutcome = (
  context: ModerationLogContext,
  outcome: ModerationOutcome,
): ModerationOutcome => {
  logger.info('画像の措置を終えました', {
    ...context,
    actionId: outcome.actionId,
    result: outcome.changed ? 'changed' : 'unchanged',
  });
  return outcome;
};

@injectable()
export class DefaultImageModerationService implements ImageModerationService {
  constructor(
    @inject(MEDIA_TYPES.MediaFiles) private readonly media: MediaFiles,
    @inject(MODERATION_TYPES.ImageModerationWriter)
    private readonly writer: ImageModerationWriter,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  approve(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'image.approve',
      applicable: (file) => file.quarantineReasons.includes('auto'),
      write: (write) => this.writer.removeReason(write, 'auto'),
    });
  }

  quarantine(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'image.quarantine',
      // 既に管理者操作の理由を持つときも、保存先の食い違いを書き込みの単位に移動を依頼し直させるため前提を求めない
      applicable: () => true,
      write: (write) => this.writer.addReason(write, 'admin_action'),
    });
  }

  release(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'image.release',
      applicable: (file) => file.quarantineReasons.includes('admin_action'),
      write: (write) => this.writer.removeReason(write, 'admin_action'),
    });
  }

  remove(command: ModerationCommand): Promise<ModerationOutcome> {
    return this.#moderate(command, {
      action: 'image.delete',
      applicable: (file) => file.quarantineReasons.length > 0,
      write: (write) => this.writer.requestErase(write),
    });
  }

  async #moderate(
    command: ModerationCommand,
    transition: ImageTransition,
  ): Promise<ModerationOutcome> {
    const { action, applicable, write } = transition;
    // 画像の操作には呼び出し側の記録を同じ一括の書き込みに入れる経路が無いため、束縛か呼び出し側の誤りとして運用者に知らせる
    if (command.participation !== undefined) {
      throw new Error(
        `画像の措置は参加の値を受け付けません: "${command.participation.kind}"`,
      );
    }
    const reason = normalizeModerationReason(action, command.reason);
    const fileId = command.targetId;
    const file = (await this.media.findMany([fileId])).get(fileId);
    if (file === undefined || file.storage !== 'images') {
      throw moderationError('image_not_found');
    }
    const operatorAdminId = command.operator.adminId;
    const logContext: ModerationLogContext = {
      action,
      fileId,
      operatorAdminId,
    };
    if (file.eraseRequested) {
      // 削除待ちの印と削除の記録は同じ一括の書き込みで確定済みのため、削除の再実行は記録を重ねない
      if (action === 'image.delete') {
        return logOutcome(logContext, NOT_CHANGED);
      }
      throw moderationError('image_not_found');
    }
    if (!applicable(file)) {
      throw moderationError('image_action_not_applicable');
    }
    const audit = this.auditLog.prepare({
      operatorAdminId,
      action,
      targetIds: [fileId],
      ...(reason === null ? {} : { reason }),
      occurredAt: command.at,
    });
    const actionId = this.ids.generate();
    const change = await write({
      fileId,
      record: {
        id: actionId,
        action,
        targetId: fileId,
        subjectUserId: subjectUserIdOf(file.owner),
        productId: null,
        operatorAdminId,
        reason,
        lifecycleEventId: null,
        occurredAt: command.at,
        noticeStatus: 'none',
      },
      audit,
    });
    if (change === 'not-found') {
      throw moderationError('image_not_found');
    }
    return logOutcome(
      logContext,
      change === 'changed'
        ? Object.freeze({ changed: true, actionId })
        : NOT_CHANGED,
    );
  }
}
