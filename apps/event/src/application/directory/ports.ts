// application層は検索対象の定義(lib/workers)を読み込めないため名前だけを持つ。定義の名前との一致はD1ProductIndexPendingMarkerのWorkers統合テストで確かめる
export const PRODUCT_SEARCH_TARGET_NAME = 'product';

export const MAX_PRODUCTS_PER_PENDING_MARK = 100;

export interface ProductIndexPendingMarker {
  // 各プロダクトの索引文書を更新待ちにする。MAX_PRODUCTS_PER_PENDING_MARK件以内を1回の一括の書き込みで書き、空の配列では書き込まない
  mark(productIds: readonly string[], at: Date): Promise<void>;
}
