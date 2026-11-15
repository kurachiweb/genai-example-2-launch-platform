import type { ComponentType } from 'react';

export interface PublicProfileSectionContext {
  readonly handle: string;
  readonly nickname: string;
  readonly isOwner: boolean;
  readonly suspended: boolean;
}

export type PublicProfileSectionComponent =
  ComponentType<PublicProfileSectionContext>;

export interface PublicProfileTab {
  // URLのクエリ`tab`の値。`/^[a-z][a-z0-9-]*$/`
  readonly id: string;
  readonly label: string;
  // product-launchのlaunches 10・match-engineのupvotes 20
  readonly order: number;
  // タブの見出しに添える件数のバッジ。自分でデータを取得する
  readonly Count?: PublicProfileSectionComponent;
  // 自分でデータを取得し、読み込み中は`Suspense`のフォールバックが示される
  readonly Panel: PublicProfileSectionComponent;
}

export interface PublicProfileBadgeSection {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // product-launchのproduct-launch.award-badges 10
  readonly order: number;
  readonly Section: PublicProfileSectionComponent;
}

export interface PublicProfileMenuItem {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // content-reportingのreport 10
  readonly order: number;
  // 表示条件は部品自身が持ち、`DropdownMenuItem`と自分のダイアログを描く
  readonly Item: PublicProfileSectionComponent;
}
