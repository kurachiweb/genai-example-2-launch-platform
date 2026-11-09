import type { ComponentType } from 'react';

export interface MyProductSectionContext {
  readonly productHandle: string;
  readonly productName: string;
  readonly hidden: boolean;
  // listは自分のプロダクトの一覧のカードの下、editは編集画面の上部の状態の区画
  readonly placement: 'list' | 'edit';
}

export interface MyProductSection {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // tournament-week・tournament-yearの参加費の導線
  readonly order: number;
  // 自分でデータを取得し、該当しなければnullを描く
  readonly component: ComponentType<{
    readonly product: MyProductSectionContext;
  }>;
}

export interface ProductDeleteNotice {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // tournament-week・tournament-year・sponsorshipの注意書き
  readonly order: number;
  // 自分でデータを取得し、該当しなければnullを描く
  readonly component: ComponentType<{ readonly productHandle: string }>;
}
