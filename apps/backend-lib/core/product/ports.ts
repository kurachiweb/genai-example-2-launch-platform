import type { BusinessDate } from '../time/business-time.ts';
import type { LaunchStatus, QualifierOutcome } from './launch-status.ts';
import type {
  ProductLifecycleEvent,
  ProductLifecycleEventStatus,
} from './product-lifecycle.ts';

export interface ProductSummaryRecord {
  readonly productId: string;
  readonly ownerUserId: string;
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly category: {
    readonly id: string;
    readonly name: string;
    readonly handle: string;
  };
  readonly websiteUrl: string;
  readonly logoFileId: string;
  readonly hidden: boolean;
  // 論理削除・非公開化・投稿者の退会と停止のどれにも当たらない
  readonly visible: boolean;
  // 可視かつ予選で勝利したローンチがある
  readonly listed: boolean;
  readonly createdAt: Date;
}

// visible: 可視のプロダクトだけ / not-deleted: 非公開化と停止中の投稿者のプロダクトを含む
export type ProductLookupScope = 'visible' | 'not-deleted';

export interface ProductDetailRecord {
  readonly productId: string;
  readonly descriptionMarkdown: string;
  // 表示順
  readonly screenshotFileIds: readonly string[];
}

export interface LaunchRecord {
  readonly launchId: string;
  readonly productId: string;
  // 取消を除いてローンチ日の古い順に1から数える。取消は0
  readonly number: number;
  readonly launchDate: BusinessDate;
  // 照会の時点で導いた値
  readonly status: LaunchStatus;
  readonly outcome: QualifierOutcome | null;
  readonly decidedAt: Date | null;
}

export type ProductHandleResolution =
  | { readonly kind: 'current'; readonly product: ProductSummaryRecord }
  // product.handleは現在のハンドルで、呼び出し元はこれを転送先にする
  | { readonly kind: 'previous'; readonly product: ProductSummaryRecord }
  | { readonly kind: 'none' };

export interface ProductDirectory {
  // 重複を除いて90件ずつ読む。論理削除済みは返さない
  findSummaries(
    productIds: readonly string[],
    scope: ProductLookupScope,
  ): Promise<ReadonlyMap<string, ProductSummaryRecord>>;
  // 論理削除済みは解決しない。可視かどうかは呼び出し元が判断する
  resolveHandle(handle: string): Promise<ProductHandleResolution>;
  // 論理削除済みはundefined
  findDetail(productId: string): Promise<ProductDetailRecord | undefined>;
  // ローンチ日の新しい順で、取消を含む
  listLaunches(
    productIds: readonly string[],
    now: Date,
  ): Promise<ReadonlyMap<string, readonly LaunchRecord[]>>;
}

export interface ProductCategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly systemDefault: boolean;
  readonly createdAt: Date;
}

export interface ProductCategoryDirectory {
  // 追加の順で、標準カテゴリを末尾に置く
  list(): Promise<readonly ProductCategoryRecord[]>;
  // 大文字小文字を区別しない
  findByHandle(handle: string): Promise<ProductCategoryRecord | undefined>;
}

export interface ScheduledLaunch {
  readonly launchId: string;
  readonly productId: string;
  readonly ownerUserId: string;
  readonly categoryId: string;
}

export interface ScheduledLaunchDirectory {
  // 取消でなく結果が未確定で、プロダクトが可視のものをローンチのIDの昇順に返す
  listForDate(input: {
    readonly launchDate: BusinessDate;
    // 直前のページの最後のローンチのID
    readonly after: string | undefined;
    // 1〜500
    readonly limit: number;
  }): Promise<{
    readonly launches: readonly ScheduledLaunch[];
    readonly next: string | undefined;
  }>;
}

export interface OutcomeEntry {
  readonly launchId: string;
  readonly outcome: QualifierOutcome;
  readonly decidedAt: Date;
}

export type OutcomeRecordResult =
  | 'recorded'
  // 同じ結果が既にある
  | 'already-recorded'
  // 異なる結果が既にあり、書き換えない
  | 'conflict'
  // 存在しない・取消・プロダクトが論理削除済み
  | 'not-recordable';

export interface LaunchOutcomeRecorder {
  // 1〜200件を1回の一括の書き込みで記録する
  record(
    entries: readonly OutcomeEntry[],
  ): Promise<ReadonlyMap<string, OutcomeRecordResult>>;
}

export interface ProductExportRecord {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  // エクスポートの時点のカテゴリ名
  readonly categoryName: string;
  readonly websiteUrl: string;
  readonly descriptionMarkdown: string;
  // データエクスポートがファイルの記録から元のファイル名・隔離・実体を引く
  readonly logoFileId: string;
  // 表示順
  readonly screenshotFileIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  readonly hiddenByAdmin: boolean;
}

export interface LaunchExportRecord {
  readonly id: string;
  readonly productId: string;
  readonly launchDate: BusinessDate;
  readonly status: LaunchStatus;
}

export interface ProductExport {
  // 論理削除済みを含め、作成の順に返す
  listByUser(userId: string): Promise<readonly ProductExportRecord[]>;
}

export interface LaunchExport {
  // ローンチ日の古い順に返す
  listByUser(userId: string, now: Date): Promise<readonly LaunchExportRecord[]>;
}

export interface StoredProductLifecycleEvent extends ProductLifecycleEvent {
  readonly status: ProductLifecycleEventStatus;
  readonly dispatchCount: number;
  readonly lastDispatchedAt: Date;
}

export interface ProductLifecycleStore {
  findEvent(eventId: string): Promise<StoredProductLifecycleEvent | undefined>;
  // 発生日時が同じならIDの昇順で最初のものを返す
  findOldestPending(
    productId: string,
  ): Promise<StoredProductLifecycleEvent | undefined>;
  completedHandlers(eventId: string): Promise<ReadonlySet<string>>;
  // 同じ処理の2回目の記録は無視する
  markHandlerCompleted(
    eventId: string,
    handlerName: string,
    at: Date,
  ): Promise<void>;
  markEventCompleted(eventId: string, at: Date): Promise<void>;
  listStalePending(
    dispatchedBefore: Date,
    limit: number,
  ): Promise<readonly StoredProductLifecycleEvent[]>;
  // 未完了のイベントの送信の回数を1増やし、最後の送信日時を記録する
  markRedispatched(eventIds: readonly string[], at: Date): Promise<void>;
  // 既に物理削除の時期の到来のイベントがあるプロダクトには作らず、作ったイベントだけを返す
  createPurgeDueEvents(
    productIds: readonly string[],
    at: Date,
  ): Promise<readonly ProductLifecycleEvent[]>;
  // 物理削除の時期の到来のイベントが無い論理削除済みのプロダクトのIDを返す
  listPurgeCandidates(
    deletedBefore: Date,
    limit: number,
  ): Promise<readonly string[]>;
  // 行の残る全てのプロダクト(論理削除済みを含む)のIDを返す
  listOwnedProductIds(
    userId: string,
    limit: number,
  ): Promise<readonly string[]>;
  purgeDueCreatedAt(
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, Date>>;
  countOverduePurges(deletedBefore: Date): Promise<number>;
}

export type AdminProductLaunchState =
  'scheduled' | 'in_progress' | 'won' | 'lost' | 'canceled';

export type AdminProductVisibility = 'visible' | 'hidden' | 'owner_suspended';

export interface AdminProductRecord {
  readonly productId: string;
  readonly ownerUserId: string;
  readonly handle: string;
  readonly name: string;
  readonly category: { readonly id: string; readonly name: string };
  readonly logoFileId: string;
  readonly hiddenAt: Date | null;
  // 非公開化をされていればhidden、されておらず投稿者が停止中ならowner_suspended
  readonly visibility: AdminProductVisibility;
  readonly latestLaunch: {
    readonly launchId: string;
    readonly launchDate: BusinessDate;
    readonly state: AdminProductLaunchState;
  } | null;
  readonly createdAt: Date;
}

export interface AdminProductSearchFilter {
  // 部分一致
  readonly name?: string;
  // 部分一致
  readonly handle?: string;
  readonly ownerUserId?: string;
  readonly categoryId?: string;
  readonly launchState?: AdminProductLaunchState;
  readonly visibility?: AdminProductVisibility;
}

export interface AdminProductDirectory {
  // 論理削除済みを除き、作成日時とIDの降順に並べる。limitは1〜50
  search(
    filter: AdminProductSearchFilter,
    page: { readonly after?: string; readonly limit: number },
    now: Date,
  ): Promise<{
    readonly products: readonly AdminProductRecord[];
    readonly nextCursor: string | null;
  }>;
  // 時点より前に登録し、時点で論理削除していないプロダクトを数える
  countRegisteredAt(at: Date): Promise<number>;
}
