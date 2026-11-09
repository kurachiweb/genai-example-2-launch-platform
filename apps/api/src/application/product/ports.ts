import type {
  LaunchRecord,
  ProductCategoryRecord,
} from '../../../lib/core/product/ports.ts';
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
