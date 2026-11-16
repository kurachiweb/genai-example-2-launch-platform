import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type { RatingStatements } from '../../../lib/workers/engagement/rating-statements.ts';
import { engagementError } from '../../application/engagement/engagement-errors.ts';
import type { ModerationChangeResult } from './comment-moderation-control.ts';

export interface RatingModerationChange {
  readonly ratingId: string;
  readonly at: Date;
  // 呼び出し側の理由と監査の記録の文。変更したときだけ状態の変更と同じ一括の書き込みで確定する
  readonly statements?: readonly BatchItem<'sqlite'>[];
}

// 権限・理由・監査・通知は呼び出し側が持ち、本操作口は呼び出し元の主体を判定しない
export interface RatingModerationControl {
  // 存在しない・評価者の退会で論理削除された評価はengagementError('rating_not_found')を投げ、既に同じ状態ならunchangedを返す
  invalidate(input: RatingModerationChange): Promise<ModerationChangeResult>;
  revalidate(input: RatingModerationChange): Promise<ModerationChangeResult>;
}

@injectable()
export class D1RatingModerationControl implements RatingModerationControl {
  constructor(
    @inject(ENGAGEMENT_PLATFORM_TYPES.RatingStatements)
    private readonly ratings: RatingStatements,
  ) {}

  invalidate(input: RatingModerationChange): Promise<ModerationChangeResult> {
    return this.#change(input, true);
  }

  revalidate(input: RatingModerationChange): Promise<ModerationChangeResult> {
    return this.#change(input, false);
  }

  async #change(
    { ratingId, at, statements }: RatingModerationChange,
    invalidated: boolean,
  ): Promise<ModerationChangeResult> {
    const result = await this.ratings.setInvalidated({
      ratingId,
      invalidated,
      at,
      statements: statements ?? [],
    });
    if (result === 'not-found') {
      throw engagementError('rating_not_found');
    }
    return result;
  }
}
