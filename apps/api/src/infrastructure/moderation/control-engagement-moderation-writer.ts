import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import { ENGAGEMENT_TYPES } from '../../application/engagement/engagement-types.ts';
import { MODERATION_TYPES } from '../../application/moderation/moderation-types.ts';
import type {
  EngagementModerationChange,
  EngagementModerationWrite,
  EngagementModerationWriter,
} from '../../application/moderation/ports.ts';
import type { CommentModerationControl } from '../engagement/comment-moderation-control.ts';
import type { RatingModerationControl } from '../engagement/rating-moderation-control.ts';
import type { D1ModerationStatements } from './d1-moderation-statements.ts';
import {
  moderationWriteContextOf,
  type ModerationWriteParticipants,
} from './moderation-write-participant.ts';

@injectable()
export class ControlEngagementModerationWriter implements EngagementModerationWriter {
  constructor(
    @inject(MODERATION_TYPES.ModerationStatements)
    private readonly statements: D1ModerationStatements,
    @inject(MODERATION_TYPES.ModerationWriteParticipants)
    private readonly participants: ModerationWriteParticipants,
    @inject(ENGAGEMENT_TYPES.CommentModerationControl)
    private readonly comments: CommentModerationControl,
    @inject(ENGAGEMENT_TYPES.RatingModerationControl)
    private readonly ratings: RatingModerationControl,
  ) {}

  async hideComment(
    write: EngagementModerationWrite,
  ): Promise<EngagementModerationChange> {
    return this.comments.hide({
      commentId: write.targetId,
      at: write.at,
      statements: await this.#statementsOf(write),
    });
  }

  async unhideComment(
    write: EngagementModerationWrite,
  ): Promise<EngagementModerationChange> {
    return this.comments.unhide({
      commentId: write.targetId,
      at: write.at,
      statements: await this.#statementsOf(write),
    });
  }

  async invalidateRating(
    write: EngagementModerationWrite,
  ): Promise<EngagementModerationChange> {
    return this.ratings.invalidate({
      ratingId: write.targetId,
      at: write.at,
      statements: await this.#statementsOf(write),
    });
  }

  async revalidateRating(
    write: EngagementModerationWrite,
  ): Promise<EngagementModerationChange> {
    return this.ratings.revalidate({
      ratingId: write.targetId,
      at: write.at,
      statements: await this.#statementsOf(write),
    });
  }

  // 上流の操作口は変更したときだけ渡した文を確定するため、既に目的の状態なら記録・監査ログ・参加者の文は残らない
  async #statementsOf(
    write: EngagementModerationWrite,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    const participantStatements = await this.participants.statementsFor(
      write.participation,
      moderationWriteContextOf(write.record),
    );
    return [
      ...this.statements.forRecord(write.record, write.audit),
      ...participantStatements,
    ];
  }
}
