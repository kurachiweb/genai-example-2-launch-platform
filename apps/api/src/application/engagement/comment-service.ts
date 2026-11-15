import { inject, injectable } from 'inversify';

import {
  COMMENT_MAX_DEPTH,
  type RatingScore,
} from '../../../common-lib/engagement/engagement-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type {
  CommentDepth,
  CommentInsert,
  CommentRecord,
  CommentStore,
  RatingStore,
} from '../../../lib/core/engagement/ports.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { CommentView } from '../../domain/engagement/comment-threads.ts';
import { isCommentableLaunch } from '../../domain/engagement/engagement-access.ts';
import { engagementError, ratingOnReplyError } from './engagement-errors.ts';
import type {
  EngagementTarget,
  EngagementTargetResolver,
} from './engagement-target-resolver.ts';
import { ENGAGEMENT_TYPES } from './engagement-types.ts';
import type { CommentWriter } from './ports.ts';
import {
  type ProductRatingView,
  readProductRatingView,
} from './product-rating-view.ts';

// 本文の検証・利用者の状態・bot判定は呼び出し元のリゾルバが先に行う
export interface CommentPostInput {
  readonly user: CurrentUser;
  readonly productId: string;
  readonly launchId: string;
  // トップレベルならundefined
  readonly parentId: string | undefined;
  readonly body: string;
  // トップレベルの投稿だけに添えられる。添えなければ既存の評価を変えない
  readonly rating: RatingScore | undefined;
  readonly now: Date;
}

export interface CommentPostResult {
  readonly comment: CommentView;
  // 評価を添えなければundefined
  readonly rating: ProductRatingView | undefined;
}

// 本文の検証と利用者の状態は呼び出し元のリゾルバが先に行う
export interface CommentUpdateInput {
  readonly user: CurrentUser;
  readonly commentId: string;
  readonly body: string;
  // トップレベルの編集だけに添えられる。添えなければ既存の評価を変えない
  readonly rating: RatingScore | undefined;
  readonly now: Date;
}

export type CommentUpdateResult = CommentPostResult;

// 利用者の状態は呼び出し元のリゾルバが先に行う。メールアドレスの確認は求めない
export interface CommentRemoveInput {
  readonly user: CurrentUser;
  readonly commentId: string;
  readonly now: Date;
}

export type RemovedCommentView = Extract<CommentView, { kind: 'removed' }>;

export interface CommentService {
  post(input: CommentPostInput): Promise<CommentPostResult>;
  update(input: CommentUpdateInput): Promise<CommentUpdateResult>;
  remove(input: CommentRemoveInput): Promise<RemovedCommentView>;
}

type RepliableParent = CommentRecord & {
  readonly authorUserId: string;
  readonly depth: 1 | 2;
};

// 親の投稿者が可視であることは書き込みの条件で確かめる
function isRepliableParent(
  parent: CommentRecord | undefined,
  launchId: string,
): parent is RepliableParent {
  return (
    parent !== undefined &&
    parent.launchId === launchId &&
    parent.depth < COMMENT_MAX_DEPTH &&
    parent.deletedAt === null &&
    parent.hiddenAt === null &&
    parent.anonymizedAt === null &&
    parent.authorUserId !== null
  );
}

function replyDepthOf(parent: CommentInsert['parent']): CommentDepth {
  if (parent === null) {
    return 1;
  }
  return parent.depth === 1 ? 2 : 3;
}

type OwnShownComment = CommentRecord & { readonly authorUserId: string };

// 投稿者自身が利用できることは呼び出し元が確かめている
function isOwnShownComment(
  comment: CommentRecord | undefined,
  userId: string,
): comment is OwnShownComment {
  return (
    comment !== undefined &&
    comment.authorUserId === userId &&
    comment.deletedAt === null &&
    comment.hiddenAt === null &&
    comment.anonymizedAt === null
  );
}

interface Editable {
  readonly comment: OwnShownComment;
  readonly target: EngagementTarget;
}

interface Postable {
  readonly target: EngagementTarget;
  readonly parent: CommentInsert['parent'];
}

@injectable()
export class StoreCommentService implements CommentService {
  constructor(
    @inject(ENGAGEMENT_TYPES.EngagementTargetResolver)
    private readonly targets: EngagementTargetResolver,
    @inject(ENGAGEMENT_PLATFORM_TYPES.CommentStore)
    private readonly comments: CommentStore,
    @inject(ENGAGEMENT_PLATFORM_TYPES.RatingStore)
    private readonly ratings: RatingStore,
    @inject(ENGAGEMENT_TYPES.CommentWriter)
    private readonly writer: CommentWriter,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async post(input: CommentPostInput): Promise<CommentPostResult> {
    const { user, productId, launchId, body, rating, now } = input;
    const authorUserId = user.user.id;
    const { target, parent } = await this.#postable(input);
    if (rating !== undefined && parent !== null) {
      throw ratingOnReplyError();
    }
    if (rating !== undefined && target.viewerIsOwner) {
      throw engagementError('rating_own_product');
    }
    const commentId = this.ids.generate();
    const outcome = await this.writer.post({
      comment: {
        commentId,
        productId,
        launchId,
        parent,
        authorUserId,
        bodyMarkdown: body,
        requireListed: !target.viewerIsOwner,
        at: now,
      },
      rating:
        rating === undefined
          ? undefined
          : {
              ratingId: this.ids.generate(),
              productId,
              userId: authorUserId,
              score: rating,
              at: now,
            },
    });
    if (outcome === 'rejected') {
      throw await this.#rejectionOf(input);
    }
    return {
      comment: {
        kind: 'shown',
        id: commentId,
        parentId: parent?.commentId ?? null,
        depth: replyDepthOf(parent),
        authorUserId,
        bodyMarkdown: body,
        createdAt: now,
        edited: false,
        byProductOwner: target.viewerIsOwner,
        viewerIsAuthor: true,
      },
      rating:
        rating === undefined
          ? undefined
          : await readProductRatingView(this.ratings, {
              productId,
              viewerUserId: authorUserId,
            }),
    };
  }

  // 投稿からの経過時間とローンチの状態では制限しない
  async update(input: CommentUpdateInput): Promise<CommentUpdateResult> {
    const { user, commentId, body, rating, now } = input;
    const userId = user.user.id;
    const { comment, target } = await this.#editable(input);
    if (rating !== undefined && comment.depth !== 1) {
      throw ratingOnReplyError();
    }
    if (rating !== undefined && target.viewerIsOwner) {
      throw engagementError('rating_own_product');
    }
    const outcome = await this.writer.update({
      body: {
        commentId,
        authorUserId: userId,
        bodyMarkdown: body,
        requireListed: !target.viewerIsOwner,
        at: now,
      },
      rating:
        rating === undefined
          ? undefined
          : {
              ratingId: this.ids.generate(),
              productId: comment.productId,
              userId,
              score: rating,
              at: now,
            },
    });
    if (outcome === 'not-found') {
      throw engagementError('comment_not_found');
    }
    if (outcome === 'rejected') {
      // 読み直してコメントと投稿先に変化が無ければ、残る条件は利用者の状態である
      await this.#editable(input);
      throw engagementError('account_unavailable');
    }
    return {
      comment: {
        kind: 'shown',
        id: commentId,
        parentId: comment.parentId,
        depth: comment.depth,
        authorUserId: userId,
        bodyMarkdown: body,
        createdAt: comment.createdAt,
        edited: true,
        byProductOwner: target.viewerIsOwner,
        viewerIsAuthor: true,
      },
      rating:
        rating === undefined
          ? undefined
          : await readProductRatingView(this.ratings, {
              productId: comment.productId,
              viewerUserId: userId,
            }),
    };
  }

  // 削除の書き込みはプロダクトの閲覧の可否を条件に持たないため、ここで判定する
  async remove(input: CommentRemoveInput): Promise<RemovedCommentView> {
    const { user, commentId, now } = input;
    const { comment } = await this.#editable(input);
    const outcome = await this.writer.remove({
      commentId,
      authorUserId: user.user.id,
      at: now,
    });
    if (outcome === 'not-found') {
      throw engagementError('comment_not_found');
    }
    return {
      kind: 'removed',
      id: commentId,
      parentId: comment.parentId,
      depth: comment.depth,
    };
  }

  // 他者・置き換え表示・閲覧できないプロダクトのコメントを区別せずに見つからないとする
  async #editable(input: {
    readonly user: CurrentUser;
    readonly commentId: string;
    readonly now: Date;
  }): Promise<Editable> {
    const userId = input.user.user.id;
    const comments = await this.comments.findByIds([input.commentId]);
    const comment = comments.get(input.commentId);
    if (!isOwnShownComment(comment, userId)) {
      throw engagementError('comment_not_found');
    }
    const target = await this.targets.resolve({
      productId: comment.productId,
      viewerUserId: userId,
      now: input.now,
    });
    if (target === undefined) {
      throw engagementError('comment_not_found');
    }
    return { comment, target };
  }

  // 投稿先・ローンチの状態・親の順に判定し、最初に当たった理由で拒否する
  async #postable(input: CommentPostInput): Promise<Postable> {
    const { user, productId, launchId, parentId, now } = input;
    const [target, parents] = await Promise.all([
      this.targets.resolve({
        productId,
        launchId,
        viewerUserId: user.user.id,
        now,
      }),
      parentId === undefined ? undefined : this.comments.findByIds([parentId]),
    ]);
    if (target?.launch === undefined) {
      throw engagementError('comment_target_not_found');
    }
    if (!isCommentableLaunch(target.launch)) {
      throw engagementError('launch_not_commentable');
    }
    if (parentId === undefined) {
      return { target, parent: null };
    }
    const parent = parents?.get(parentId);
    if (!isRepliableParent(parent, launchId)) {
      throw engagementError('comment_parent_unavailable');
    }
    return {
      target,
      parent: {
        commentId: parent.commentId,
        rootId: parent.rootId,
        depth: parent.depth,
      },
    };
  }

  // 書き込みの条件のうち、読み直しで確かめられない残りは親の投稿者の状態(返信)と利用者の状態である。
  // 利用者の状態は呼び出し元がこの要求で確かめたばかりで、AccountGuardは同じ要求の中で利用者を読み直さないため、返信では親の投稿者が表示できなくなったものとする
  async #rejectionOf(input: CommentPostInput): Promise<Error> {
    await this.#postable(input);
    return engagementError(
      input.parentId === undefined
        ? 'account_unavailable'
        : 'comment_parent_unavailable',
    );
  }
}
