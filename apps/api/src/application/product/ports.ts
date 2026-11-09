import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type { MessageContract } from '../../../lib/core/messaging/message-contract.ts';
import type {
  LaunchRecord,
  ProductCategoryRecord,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import type {
  ProductLifecycleEvent,
  SyncProductLifecycleEventType,
} from '../../../lib/core/product/product-lifecycle.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import type { ProductEditPlan } from '../../domain/product/product-edit-plan.ts';
import type { ProductState } from './product-state-evaluator.ts';

export interface ProductFieldsInput {
  // 前後の空白を除いた値
  readonly name: string;
  readonly tagline: string;
  readonly categoryId: string;
  readonly handle: string;
  readonly websiteUrl: string;
  readonly descriptionMarkdown: string;
  readonly logoFileId: string;
  // 0〜20件、表示順
  readonly screenshotFileIds: readonly string[];
}

export interface MyProductView {
  readonly productId: string;
  readonly handle: string;
  readonly previousHandle: string | null;
  readonly name: string;
  readonly tagline: string;
  readonly category: ProductCategoryRecord;
  readonly websiteUrl: string;
  readonly descriptionMarkdown: string;
  readonly logoFileId: string;
  readonly screenshotFileIds: readonly string[];
  readonly hidden: boolean;
  readonly listed: boolean;
  readonly version: number;
  readonly state: ProductState;
}

export interface ProductSnapshot extends Omit<
  MyProductView,
  'state' | 'listed'
> {
  readonly ownerUserId: string;
  // ローンチ日の新しい順で、取消を含む
  readonly launches: readonly LaunchRecord[];
}

export type ProductSaveResult =
  | 'saved'
  // 版が違う
  | 'conflict'
  | 'handle-unavailable'
  // 予選の固定の期間
  | 'locked'
  // 次回の予約で非公開化中
  | 'hidden'
  | 'account-unavailable'
  | 'not-found';

export interface ProductListPosition {
  readonly latestLaunchDate: BusinessDate;
  readonly id: string;
}

export interface ProductInsertInput {
  readonly productId: string;
  readonly launchId: string;
  readonly ownerUserId: string;
  readonly fields: ProductFieldsInput;
  readonly launchDate: BusinessDate;
  // スクリーンショットの行のID。fields.screenshotFileIdsと同じ件数
  readonly screenshotIds: readonly string[];
  readonly now: Date;
}

export interface ProductSaveInput {
  readonly productId: string;
  readonly expectedVersion: number;
  readonly fields: ProductFieldsInput;
  readonly plan: ProductEditPlan;
  // ハンドルを別の文字列に変えるときに旧ハンドルの行へ使うID
  readonly previousHandleId: string;
  // 次回の予約のときにローンチの行へ使うID
  readonly newLaunchId: string;
  // スクリーンショットの行のID。fields.screenshotFileIdsと同じ件数
  readonly screenshotIds: readonly string[];
  readonly now: Date;
}

export interface ProductDescriptionUpdateInput {
  readonly productId: string;
  readonly descriptionMarkdown: string;
  readonly now: Date;
}

export type ProductDescriptionUpdateResult =
  'saved' | 'not-found' | 'account-unavailable' | 'hidden';

// insert・save・updateDescriptionは、'saved'の確定の後に保存の登録口の確定の後の処理まで済ませて返す
export interface ProductStore {
  // 現在のハンドルで本人のもの。他人・論理削除済み・旧ハンドルはundefined
  findForOwner(
    ownerUserId: string,
    handle: string,
    now: Date,
  ): Promise<ProductSnapshot | undefined>;
  // 本人の論理削除していないプロダクトの旧ハンドルなら現在のハンドル
  resolveOwnPreviousHandle(
    ownerUserId: string,
    handle: string,
  ): Promise<string | undefined>;
  // 論理削除していない本人のプロダクトを、最新のローンチ日とIDの降順に位置より後からlimit件まで返す
  listForOwner(input: {
    readonly ownerUserId: string;
    readonly limit: number;
    readonly before: ProductListPosition | undefined;
    readonly now: Date;
  }): Promise<readonly ProductSnapshot[]>;
  // 他のプロダクトの現在のハンドル(論理削除済みを含む)だけを使用中とする
  isHandleOccupied(handle: string, exceptProductId?: string): Promise<boolean>;
  categoryExists(categoryId: string): Promise<boolean>;
  insert(
    input: ProductInsertInput,
  ): Promise<'saved' | 'handle-unavailable' | 'account-unavailable'>;
  save(input: ProductSaveInput): Promise<ProductSaveResult>;
  // 書き込みの時点で非公開化中なら'hidden'
  updateDescription(
    input: ProductDescriptionUpdateInput,
  ): Promise<ProductDescriptionUpdateResult>;
}

// owner: 論理削除と非公開化を除く本人のプロダクト(未掲載・停止中の投稿者を含む) / public: 掲載済みのプロダクト
export type LaunchHistoryScope = 'owner' | 'public';

export interface LaunchHistoryProductRecord extends ProductSummaryRecord {
  // 取消を含む全ローンチの最新の日で、一覧の並びの位置に使う
  readonly latestLaunchDate: BusinessDate;
}

export interface LaunchHistoryStore {
  count(input: {
    readonly userId: string;
    readonly scope: LaunchHistoryScope;
  }): Promise<number>;
  // 最新のローンチ日とIDの降順に位置より後からlimit件まで返す
  list(input: {
    readonly userId: string;
    readonly scope: LaunchHistoryScope;
    readonly limit: number;
    readonly before: ProductListPosition | undefined;
  }): Promise<readonly LaunchHistoryProductRecord[]>;
}

export interface ProductCategoryWriteInput {
  readonly id: string;
  // 前後の空白を除いた値
  readonly name: string;
  readonly handle: string;
  readonly at: Date;
}

// 名前とハンドルは大文字小文字を区別せずに他のカテゴリと重なれば拒否する
export type ProductCategoryInsertResult =
  'created' | 'name-taken' | 'handle-taken';

export type ProductCategoryUpdateResult =
  'updated' | 'name-taken' | 'handle-taken' | 'not-found' | 'protected';

// 論理削除後に物理削除されていないプロダクトが紐付く場合もin-use
export type ProductCategoryDeleteResult =
  'deleted' | 'in-use' | 'not-found' | 'protected';

// 書き込みは監査ログと1つの一括の書き込みで確定し、拒否のときは監査ログも残さない
export interface ProductCategoryStore {
  // 追加の順で、標準カテゴリを末尾に置く
  list(): Promise<readonly ProductCategoryRecord[]>;
  findById(id: string): Promise<ProductCategoryRecord | undefined>;
  insert(
    input: ProductCategoryWriteInput,
    audit: PreparedAuditEntry,
  ): Promise<ProductCategoryInsertResult>;
  // 変更前のハンドルを旧ハンドルとして保持しない
  update(
    input: ProductCategoryWriteInput,
    audit: PreparedAuditEntry,
  ): Promise<ProductCategoryUpdateResult>;
  delete(
    id: string,
    audit: PreparedAuditEntry,
  ): Promise<ProductCategoryDeleteResult>;
}

export interface ProductLifecycleCommand {
  readonly type: SyncProductLifecycleEventType;
  readonly productId: string;
  // deletedだけが使い、省けば版を条件にしない
  readonly expectedVersion?: number;
  readonly at: Date;
}

export type ProductLifecycleRejection =
  'not-found' | 'conflict' | 'locked' | 'account-unavailable';

export type ProductLifecycleCommitResult =
  | { readonly kind: 'committed'; readonly event: ProductLifecycleEvent }
  // hidden・unhiddenで既に同じ状態
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rejected'; readonly reason: ProductLifecycleRejection };

// 状態の変更・イベントの記録・同期の処理の文を1つの一括の書き込みで確定する。送信は呼び出し側が確定の後に行う
export interface ProductLifecycleCommitter {
  commit(
    command: ProductLifecycleCommand,
  ): Promise<ProductLifecycleCommitResult>;
}

// application層は共通ライブラリのworkersの送信部品を読み込めないため、PLATFORM_TYPES.MessagePublisherに束縛された部品をこの形で受け取る
export interface ProductMessagePublisher {
  publish<TType extends string, TBody>(
    contract: MessageContract<TType, TBody>,
    body: TBody,
  ): Promise<string>;
}

export type ProductIncident =
  | { readonly kind: 'product-purge-overdue'; readonly count: number }
  | {
      readonly kind: 'product-lifecycle-events-redispatched';
      readonly count: number;
      readonly stuckEventIds: readonly string[];
    };

// application層はSentryの送信部品を読み込めないため、運用者が検知すべき出来事をこの形で受け取る
export interface ProductIncidentReporter {
  // 運用者が検知できるようログとエラートラッキングへ送る。個人情報を含めない
  report(incident: ProductIncident): void;
}
