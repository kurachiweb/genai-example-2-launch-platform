import type { ComponentType, RefObject } from 'react';

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

export interface PublicProfileMenuItemProps extends PublicProfileSectionContext {
  // 選ぶとメニューを閉じ、同じ登録の`Dialog`を開く
  readonly onSelect: () => void;
}

export interface PublicProfileMenuDialogProps extends PublicProfileSectionContext {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  // 閉じた後にフォーカスを戻す「その他の操作」のボタン
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
}

export interface PublicProfileMenuItem {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // content-reportingのreport 10
  readonly order: number;
  // メニューの中に描く。表示条件は部品自身が持ち、`DropdownMenuItem`を描いて選択で`onSelect`を呼び、該当しなければnullを描く
  readonly Item: ComponentType<PublicProfileMenuItemProps>;
  // メニューが閉じると中身が外れるため、メニューの外に描く。`open`の間だけ開き、閉じると`returnFocusRef`へフォーカスを戻す
  readonly Dialog: ComponentType<PublicProfileMenuDialogProps>;
}
