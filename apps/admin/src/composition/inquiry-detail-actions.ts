import type { ComponentType } from 'react';

export interface InquiryDetailActionContext {
  readonly inquiryId: string;
  readonly kind: 'member' | 'guest';
  // ログインの問い合わせの利用者のID。未ログインと、送った利用者を読めないログインの問い合わせはnull
  readonly userId: string | null;
  // 利用者が退会済みなら真。未ログインは常に偽
  readonly withdrawn: boolean;
  // 未ログインの問い合わせの連絡先メールアドレス。ログインはnull
  readonly contactEmail: string | null;
}

export interface InquiryDetailAction {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // 10刻みで後続specが定める
  readonly order: number;
  // 表示の条件(ロール・種別・状態)と必要なデータの取得は部品が自分で持つ
  readonly component: ComponentType<{
    readonly inquiry: InquiryDetailActionContext;
  }>;
}

// 問い合わせの詳細のページに並べる操作の登録箇所。後続specが操作を追記する
export const INQUIRY_DETAIL_ACTIONS: readonly InquiryDetailAction[] =
  Object.freeze([]);
