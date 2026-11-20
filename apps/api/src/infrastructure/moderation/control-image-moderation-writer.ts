import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { QuarantineReason } from '../../../lib/core/media/media-file.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaModerationControl } from '../../../lib/workers/media/media-moderation-control.ts';
import { MODERATION_TYPES } from '../../application/moderation/moderation-types.ts';
import type {
  ImageModerationChange,
  ImageModerationWrite,
  ImageModerationWriter,
} from '../../application/moderation/ports.ts';
import type { D1ModerationStatements } from './d1-moderation-statements.ts';

// 媒体の操作口は状態を変えたときだけ渡した文を確定するため、既に目的の状態なら記録と監査ログは残らない。画像の操作は参加者の文を持たない
@injectable()
export class ControlImageModerationWriter implements ImageModerationWriter {
  constructor(
    @inject(MODERATION_TYPES.ModerationStatements)
    private readonly statements: D1ModerationStatements,
    @inject(MEDIA_TYPES.MediaModerationControl)
    private readonly media: MediaModerationControl,
  ) {}

  addReason(
    write: ImageModerationWrite,
    reason: QuarantineReason,
  ): Promise<ImageModerationChange> {
    return this.media.addReason({
      fileId: write.fileId,
      reason,
      statements: this.#statementsOf(write),
    });
  }

  removeReason(
    write: ImageModerationWrite,
    reason: QuarantineReason,
  ): Promise<ImageModerationChange> {
    return this.media.removeReason({
      fileId: write.fileId,
      reason,
      statements: this.#statementsOf(write),
    });
  }

  requestErase(write: ImageModerationWrite): Promise<ImageModerationChange> {
    return this.media.requestErase({
      fileId: write.fileId,
      statements: this.#statementsOf(write),
    });
  }

  #statementsOf(write: ImageModerationWrite): readonly BatchItem<'sqlite'>[] {
    return this.statements.forRecord(write.record, write.audit);
  }
}
