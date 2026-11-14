import type { ComponentType } from 'react';

import type { ProductPageView } from '../../graphql/product-page.ts';

// bannerは本文とサイドバーの上(全幅)、mainは本文の開催中のマッチの下、asideはサイドバー(1024px未満はヘッダーの直後)、bottomは本文の末尾
export type ProductPagePlacement = 'banner' | 'main' | 'aside' | 'bottom';

export interface ProductPageContext {
  readonly product: {
    readonly id: string;
    // 現在のハンドル
    readonly handle: string;
    readonly name: string;
    // 偽なら投稿者本人だけが見ている
    readonly listed: boolean;
    readonly ownerHandle: string;
  };
  readonly viewer: { readonly signedIn: boolean; readonly isOwner: boolean };
  // ページが取得した詳細ページの結果。本specの区画が使う
  readonly page: ProductPageView;
  // ページ全体の「自動更新」の状態。偽の間、区画は定期の取り直し・数値の毎秒の更新・演出を止める。境界の時刻の取り直しと操作の後の更新は止めない
  readonly autoRefresh: boolean;
  // 定期の取り直し・数値の毎秒の更新・演出を持つ間はtrue、持たなくなればfalseを申告する。ページは切り替えを描くかの判定に使い、区画の失敗とアンマウントで申告を消す
  readonly reportAutoUpdating: (active: boolean) => void;
}

export interface ProductPageSection {
  // '<spec名>.<名詞句>'
  readonly id: string;
  readonly placement: ProductPagePlacement;
  // 置き場所ごとの順の値は002-page-layoutsの「プロダクト詳細の区画の登録」を正とする
  readonly order: number;
  // 自分でデータを取得し、該当しなければnullを描く
  readonly component: ComponentType<ProductPageContext>;
}

export type ProductOwnerActionContext = Omit<
  ProductPageContext,
  'page' | 'autoRefresh' | 'reportAutoUpdating'
>;

export interface ProductLaunchSectionContext extends ProductOwnerActionContext {
  readonly launch: {
    readonly id: string;
    // 取消を除いて古い順に1から数える回
    readonly number: number;
    // マッチ中か結果が確定した
    readonly kickedOff: boolean;
    // キックオフ済みで最も新しいローンチ
    readonly latestKickedOff: boolean;
  };
}

export interface ProductLaunchSection {
  // '<spec名>.<名詞句>'
  readonly id: string;
  readonly order: number;
  // マッチ履歴の各ローンチのブロックのマッチの一覧の下に描く。該当しなければnullを描く
  readonly component: ComponentType<ProductLaunchSectionContext>;
}

export interface ProductOwnerAction {
  // '<spec名>.<名詞句>'
  readonly id: string;
  readonly order: number;
  // 投稿者本人向けの操作の進行状況の下、「編集」「再ローンチを予約」の上に描く。該当しなければnullを描く
  readonly component: ComponentType<ProductOwnerActionContext>;
}
