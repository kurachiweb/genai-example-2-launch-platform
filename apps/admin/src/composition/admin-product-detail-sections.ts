import type { ComponentType } from 'react';

export interface AdminProductDetailContext {
  readonly productId: string;
  // 投稿者の利用者のID。退会などで投稿者を読めないプロダクトはnull
  readonly ownerUserId: string | null;
}

export interface AdminProductDetailSection {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // 10刻みで後続specが定める
  readonly order: number;
  // 区画の取得の失敗の表示で、区画が描けない見出しの代わりに示す
  readonly title: string;
  // 区画は必要なデータを自分で取得し、見出しを自分で描く
  readonly component: ComponentType<{
    readonly product: AdminProductDetailContext;
  }>;
}

// プロダクトの詳細のページに並べる区画の登録箇所。後続specが区画を追記する
export const ADMIN_PRODUCT_DETAIL_SECTIONS: readonly AdminProductDetailSection[] =
  Object.freeze([]);
