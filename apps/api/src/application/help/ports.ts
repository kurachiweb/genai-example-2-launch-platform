import type { HelpArticleStatus } from '../../../common-lib/help/help-article-status.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type { HelpHandleChange } from '../../domain/help/help-handle-change.ts';

export interface HelpArticleWrite {
  readonly handle: string;
  // 前後の空白を除いた値
  readonly title: string;
  readonly subtitle: string;
  readonly bodyMarkdown: string;
  readonly categoryId: string;
  readonly pinned: boolean;
  readonly status: HelpArticleStatus;
}

export interface HelpArticleRecord extends HelpArticleWrite {
  readonly id: string;
  readonly previousHandle: string | null;
  readonly categoryName: string;
  readonly createdByAdminId: string;
  readonly sortOrder: number;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type HelpArticleListRecord = Omit<
  HelpArticleRecord,
  'bodyMarkdown' | 'subtitle' | 'previousHandle'
>;

// 取り消された保存の理由は、取り消しの後の読み直しで分類する
export type HelpArticleSaveResult =
  | { readonly kind: 'saved'; readonly record: HelpArticleRecord }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'category-missing' }
  | { readonly kind: 'handle-unavailable' };

export type HelpReorderResult = 'reordered' | 'outdated';

export interface HelpArticleCreateInput {
  readonly id: string;
  readonly write: HelpArticleWrite;
  readonly createdByAdminId: string;
  readonly now: Date;
  readonly audit: PreparedAuditEntry;
}

export interface HelpArticleUpdateInput {
  readonly id: string;
  readonly expectedRevision: number;
  readonly write: HelpArticleWrite;
  readonly handleChange: HelpHandleChange;
  readonly categoryChanged: boolean;
  readonly now: Date;
  readonly audit: PreparedAuditEntry;
}

export interface HelpArticleStore {
  findById(id: string): Promise<HelpArticleRecord | undefined>;
  listAll(): Promise<readonly HelpArticleListRecord[]>;
  // 下書きを含む他の記事の現在のハンドルだけを使用中とし、他の記事の旧ハンドルは数えない
  isHandleOccupied(handle: string, exceptArticleId?: string): Promise<boolean>;
  // 同じ旧ハンドルを保持する他の記事のID(使用可否の案内用)
  findPreviousHandleHolder(
    handle: string,
    exceptArticleId?: string,
  ): Promise<string | undefined>;
  // 記事の挿入・他の記事の同じ旧ハンドルの解放・索引の更新待ち・監査ログを1つの一括の書き込みで確定させる。並び順はカテゴリの末尾
  create(input: HelpArticleCreateInput): Promise<HelpArticleSaveResult>;
  // 存在と版の確認・記事の更新・旧ハンドルの解放と置き換え・索引・監査ログを1つの一括の書き込みで確定させる
  update(input: HelpArticleUpdateInput): Promise<HelpArticleSaveResult>;
  delete(input: {
    readonly id: string;
    readonly audit: PreparedAuditEntry;
  }): Promise<'deleted' | 'not-found'>;
  reorder(input: {
    readonly categoryId: string;
    // ピン留めの群に続けてそれ以外の群
    readonly orderedIds: readonly string[];
    readonly audit: PreparedAuditEntry;
  }): Promise<HelpReorderResult>;
}

export interface HelpCategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly systemDefault: boolean;
  readonly sortOrder: number;
  // 下書き・公開を問わない
  readonly articleCount: number;
  readonly createdAt: Date;
}

export interface HelpCategoryStore {
  list(): Promise<readonly HelpCategoryRecord[]>;
  findById(id: string): Promise<HelpCategoryRecord | undefined>;
  // 並び順は末尾
  create(input: {
    readonly id: string;
    readonly name: string;
    readonly now: Date;
    readonly audit: PreparedAuditEntry;
  }): Promise<'created' | 'name-taken'>;
  rename(input: {
    readonly id: string;
    readonly name: string;
    readonly now: Date;
    readonly audit: PreparedAuditEntry;
  }): Promise<'renamed' | 'name-taken' | 'not-found'>;
  // 記事を標準カテゴリの末尾へ元の相対的な順で付け替え、カテゴリの削除と監査ログを1つの一括の書き込みで確定させる
  deleteAndReassign(input: {
    readonly id: string;
    readonly audit: PreparedAuditEntry;
  }): Promise<'deleted' | 'not-found'>;
  reorder(input: {
    readonly orderedIds: readonly string[];
    readonly audit: PreparedAuditEntry;
  }): Promise<HelpReorderResult>;
}

export interface PublishedHelpArticleRecord {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly subtitle: string;
  readonly pinned: boolean;
  readonly categoryId: string;
  readonly sortOrder: number;
  readonly createdAt: Date;
}

export interface PublishedHelpCategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly createdAt: Date;
}

export interface PublicHelpArticleDetailRecord extends PublishedHelpArticleRecord {
  readonly bodyMarkdown: string;
  readonly categoryName: string;
  readonly createdByAdminId: string;
  readonly updatedAt: Date;
  // 自身を除く同じカテゴリの公開の記事
  readonly sameCategory: readonly PublishedHelpArticleRecord[];
}

export type PublicHelpResolution =
  | { readonly kind: 'current'; readonly articleId: string }
  | { readonly kind: 'previous'; readonly articleId: string }
  | { readonly kind: 'none' };

export type PublicHelpSearchHitRecord = PublishedHelpArticleRecord & {
  readonly categoryName: string;
};

export interface PublicHelpStore {
  // 全カテゴリと公開の記事を1回の一括の読み取りで得る
  listPublished(): Promise<{
    readonly categories: readonly PublishedHelpCategoryRecord[];
    readonly articles: readonly PublishedHelpArticleRecord[];
  }>;
  // 現在のハンドルは公開の記事だけを、旧ハンドルは保持者の状態によらず解決する
  resolve(handle: string): Promise<PublicHelpResolution>;
  // 下書きはundefined
  findPublishedDetail(
    articleId: string,
  ): Promise<PublicHelpArticleDetailRecord | undefined>;
  // 旧ハンドルの転送先で、保持者が下書きならundefined
  findPublishedHandle(articleId: string): Promise<string | undefined>;
  // 関連度の順
  search(
    matchExpression: string,
    limit: number,
  ): Promise<readonly PublicHelpSearchHitRecord[]>;
}
