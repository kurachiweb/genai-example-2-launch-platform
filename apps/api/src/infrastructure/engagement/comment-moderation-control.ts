import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type { CommentStatements } from '../../../lib/workers/engagement/comment-statements.ts';
import { engagementError } from '../../application/engagement/engagement-errors.ts';

export type ModerationChangeResult = 'changed' | 'unchanged';

export interface CommentModerationChange {
  readonly commentId: string;
  readonly at: Date;
  // 呼び出し側の理由と監査の記録の文。変更したときだけ状態の変更と同じ一括の書き込みで確定する
  readonly statements?: readonly BatchItem<'sqlite'>[];
}

// 権限・理由・監査・通知は呼び出し側が持ち、本操作口は呼び出し元の主体を判定しない
export interface CommentModerationControl {
  // 存在しないコメントはengagementError('comment_not_found')を投げ、既に同じ状態ならunchangedを返す
  hide(input: CommentModerationChange): Promise<ModerationChangeResult>;
  // 削除・退会・停止・匿名化に当たるコメントは置き換え表示のまま
  unhide(input: CommentModerationChange): Promise<ModerationChangeResult>;
}

@injectable()
export class D1CommentModerationControl implements CommentModerationControl {
  constructor(
    @inject(ENGAGEMENT_PLATFORM_TYPES.CommentStatements)
    private readonly comments: CommentStatements,
  ) {}

  hide(input: CommentModerationChange): Promise<ModerationChangeResult> {
    return this.#change(input, true);
  }

  unhide(input: CommentModerationChange): Promise<ModerationChangeResult> {
    return this.#change(input, false);
  }

  async #change(
    { commentId, at, statements }: CommentModerationChange,
    hidden: boolean,
  ): Promise<ModerationChangeResult> {
    const result = await this.comments.setHidden({
      commentId,
      hidden,
      at,
      statements: statements ?? [],
    });
    if (result === 'not-found') {
      throw engagementError('comment_not_found');
    }
    return result;
  }
}
