import type { ComponentType } from 'react';

import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';

// bannerは見出しの上、asideは一覧の横の列(1024px未満は一覧の下)、bottomはローンチ予約への導線の下
export type DirectoryPlacement = 'banner' | 'aside' | 'bottom';

export interface DirectorySectionContext {
  readonly viewer: { readonly signedIn: boolean };
  // URLから正規化した現在の条件
  readonly query: DirectoryQuery;
}

export interface DirectorySection {
  // '<spec名>.<名詞句>'
  readonly id: string;
  readonly placement: DirectoryPlacement;
  readonly order: number;
  // 自分でデータを取得し、該当しなければnullを描く
  readonly component: ComponentType<DirectorySectionContext>;
}

export interface DirectoryListInsert {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // 同じ位置に入る差し込みの順
  readonly order: number;
  // 一覧の項目の何件ごとに差し込むか。1以上の整数。件数が割り切れるときは最後の項目の後にも差し込む
  readonly every: number;
  // positionはその差し込みの1から数えた回数
  readonly component: ComponentType<{ readonly position: number }>;
}

export interface DirectoryItemMetric {
  // APIサーバーの一覧の項目の値の供給元の登録(DIRECTORY_ITEM_METRIC_SOURCES)のkeyと一致させる
  readonly key: string;
  readonly order: number;
  // 値を返したプロダクトの項目にだけ描く
  readonly component: ComponentType<{
    readonly value: number;
    readonly productHandle: string;
    readonly productName: string;
  }>;
}
