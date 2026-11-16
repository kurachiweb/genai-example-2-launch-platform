import type { RatingScore } from '../../../common-lib/engagement/engagement-rules.ts';

export type CommentDepth = 1 | 2 | 3;

export interface CommentRecord {
  readonly commentId: string;
  readonly productId: string;
  readonly launchId: string;
  readonly parentId: string | null;
  readonly rootId: string;
  readonly depth: CommentDepth;
  // 匿名化でnull
  readonly authorUserId: string | null;
  // 匿名化で空
  readonly bodyMarkdown: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly hiddenAt: Date | null;
  readonly anonymizedAt: Date | null;
}

export interface CommentInsert {
  readonly commentId: string;
  readonly productId: string;
  readonly launchId: string;
  // トップレベルはnull。返信のルートと階層は親から決まる
  readonly parent: {
    readonly commentId: string;
    readonly rootId: string;
    readonly depth: 1 | 2;
  } | null;
  readonly authorUserId: string;
  readonly bodyMarkdown: string;
  // 投稿者がプロダクトの投稿者本人でなければtrue(未掲載のプロダクトへ書き込ませない)
  readonly requireListed: boolean;
  readonly at: Date;
}

export interface CommentBodyUpdate {
  readonly commentId: string;
  readonly authorUserId: string;
  readonly bodyMarkdown: string;
  readonly requireListed: boolean;
  readonly at: Date;
}

export interface CommentSoftDelete {
  readonly commentId: string;
  readonly authorUserId: string;
  readonly at: Date;
}

export interface CommentStore {
  // 状態によらず存在する行を返し、重複を除いて90件ずつ読む
  findByIds(
    commentIds: readonly string[],
  ): Promise<ReadonlyMap<string, CommentRecord>>;
}

// 置き換え表示(removed)は本文・投稿者・日時を持たない
export type CommentRow =
  | {
      readonly kind: 'shown';
      readonly commentId: string;
      readonly parentId: string | null;
      readonly depth: CommentDepth;
      readonly authorUserId: string;
      readonly bodyMarkdown: string;
      readonly createdAt: Date;
      readonly edited: boolean;
    }
  | {
      readonly kind: 'removed';
      readonly commentId: string;
      readonly parentId: string | null;
      readonly depth: CommentDepth;
    };

export interface CommentThreadRows {
  readonly root: CommentRow;
  // 作成の古い順
  readonly replies: readonly CommentRow[];
}

export interface CommentThreadPageInput {
  readonly launchId: string;
  readonly after:
    { readonly createdAt: number; readonly commentId: string } | undefined;
}

export interface CommentThreadPage {
  readonly threads: readonly CommentThreadRows[];
  readonly hasNextPage: boolean;
}

export interface CommentThreadQuery {
  // トップレベルの新しい順のページと各ルートの返信を1回の一括の読み取りで返す
  page(input: CommentThreadPageInput): Promise<CommentThreadPage>;
  // ローンチのID→表示できるコメントの数
  countsByLaunch(productId: string): Promise<ReadonlyMap<string, number>>;
  // プロダクトのID→表示できるコメントの数。90件ずつ読む
  countsByProduct(
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
}

export interface RatingSummary {
  // 丸めない平均値。有効な評価が無ければnull
  readonly average: number | null;
  readonly count: number;
}

export interface RatingUpsert {
  readonly ratingId: string;
  readonly productId: string;
  readonly userId: string;
  readonly score: RatingScore;
  readonly at: Date;
}

export interface RatingStore {
  // 物理削除し、行が無ければfalse
  remove(input: {
    readonly productId: string;
    readonly userId: string;
  }): Promise<boolean>;
  // 論理削除されていない行を、管理者による無効化の有無によらず返す
  findScore(input: {
    readonly productId: string;
    readonly userId: string;
  }): Promise<
    { readonly ratingId: string; readonly score: RatingScore } | undefined
  >;
  // 有効な評価だけの平均値と件数。90件ずつ読む
  summaries(
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, RatingSummary>>;
}

export interface EngagementErasureStore {
  // 本文を空・投稿者をnull・匿名化の日時を入れた件数
  anonymizeDeletedBefore(input: {
    readonly threshold: Date;
    readonly at: Date;
    readonly limit: 500;
  }): Promise<number>;
  // 削除の日時が閾値より前で未匿名化のコメントの件数
  countOverdue(threshold: Date): Promise<number>;
  // コメントの匿名化と評価の削除を1回の一括の書き込みで行う
  eraseAccount(input: {
    readonly userId: string;
    readonly at: Date;
    readonly limit: 500;
  }): Promise<{ readonly remaining: boolean }>;
  // 評価とコメント(階層の深い順)を1回の一括の書き込みで消す
  eraseProduct(input: {
    readonly productId: string;
    readonly limit: 500;
  }): Promise<{ readonly remaining: boolean }>;
}

export interface CommentExportRecord {
  readonly id: string;
  readonly productId: string;
  readonly launchId: string;
  readonly parentId: string | null;
  readonly bodyMarkdown: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly hiddenByAdmin: boolean;
}

export interface CommentExport {
  // 未匿名化の自分のコメントを作成の古い順に返す
  listByUser(userId: string): Promise<readonly CommentExportRecord[]>;
}

export interface RatingExportRecord {
  readonly productId: string;
  readonly score: RatingScore;
  readonly invalidatedByAdmin: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RatingExport {
  // 論理削除されていない自分の評価を返す
  listByUser(userId: string): Promise<readonly RatingExportRecord[]>;
}

export type AdminCommentState =
  'hidden' | 'deleted' | 'anonymized' | 'author_unavailable' | 'shown';

export interface AdminCommentRecord {
  readonly commentId: string;
  readonly productId: string;
  readonly launchId: string;
  readonly authorUserId: string | null;
  // 本文の先頭200文字。匿名化は空
  readonly excerpt: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  // 非公開化・削除・匿名化・投稿者が利用できない・表示中の順に優先して1つに決める
  readonly state: AdminCommentState;
}

export interface AdminCommentSearchFilter {
  readonly authorUserId?: string;
  readonly productId?: string;
  // 含む
  readonly postedFrom?: Date;
  // 含まない
  readonly postedBefore?: Date;
  readonly state?: AdminCommentState;
}

export interface AdminDirectoryPage {
  readonly after?: string;
  // 呼び出し側が1〜100で渡す
  readonly limit: number;
}

export interface AdminCommentDirectory {
  // 作成の新しい順。不正なカーソルはAppError(bad_request, 'invalid_cursor')
  search(
    filter: AdminCommentSearchFilter,
    page: AdminDirectoryPage,
  ): Promise<{
    readonly comments: readonly AdminCommentRecord[];
    readonly nextCursor: string | null;
  }>;
}

export type AdminRatingState = 'valid' | 'invalidated';

export interface AdminRatingRecord {
  readonly ratingId: string;
  readonly productId: string;
  readonly userId: string;
  readonly score: RatingScore;
  readonly invalidatedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AdminRatingSearchFilter {
  readonly productId?: string;
  readonly userId?: string;
  readonly state?: AdminRatingState;
}

export interface AdminRatingDirectory {
  // 論理削除されていない行を更新の新しい順に返す。不正なカーソルはAppError(bad_request, 'invalid_cursor')
  search(
    filter: AdminRatingSearchFilter,
    page: AdminDirectoryPage,
  ): Promise<{
    readonly ratings: readonly AdminRatingRecord[];
    readonly nextCursor: string | null;
  }>;
  // 論理削除されていない行だけを90件ずつ読む
  findByIds(
    ratingIds: readonly string[],
  ): Promise<ReadonlyMap<string, AdminRatingRecord>>;
}
