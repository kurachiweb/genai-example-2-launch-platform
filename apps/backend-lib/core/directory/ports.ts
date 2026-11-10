import type { DirectorySort } from '../../../common-lib/directory/directory-query-rules.ts';
import type { BusinessDate } from '../time/business-time.ts';

export interface DirectoryListingInput {
  // buildFtsMatchExpressionの結果
  readonly matchExpression: string | undefined;
  readonly categoryId: string | undefined;
  readonly from: BusinessDate | undefined;
  readonly to: BusinessDate | undefined;
  // matchExpressionが無いときrelevanceは渡さない
  readonly sort: DirectorySort;
  // 1以上
  readonly page: number;
}

// 基準勝利は、期間の条件を満たす予選の勝利のうち実施日が最大のもの
export interface DirectoryBaseWin {
  readonly launchId: string;
  readonly matchDate: BusinessDate;
  readonly upvoteCount: number;
}

export interface DirectoryListingRow {
  readonly productId: string;
  readonly baseWin: DirectoryBaseWin;
}

export interface DirectoryListingPage {
  readonly totalCount: number;
  readonly rows: readonly DirectoryListingRow[];
}

export interface DirectoryListingQuery {
  // 一覧と総件数を1回の一括の読み取りで読む
  page(input: DirectoryListingInput): Promise<DirectoryListingPage>;
}

export interface DirectoryEntry {
  readonly productId: string;
  readonly ownerUserId: string;
}

export interface DirectoryEntryStore {
  // 記録済みのプロダクトは無視する
  record(entries: readonly DirectoryEntry[], at: Date): Promise<void>;
  exists(productId: string): Promise<boolean>;
  // product_idの昇順
  listProductIdsByOwner(
    ownerUserId: string,
    after: string | undefined,
    limit: number,
  ): Promise<readonly string[]>;
  // 索引文書と記録を1つの一括の書き込みで消す
  erase(productId: string): Promise<void>;
}
