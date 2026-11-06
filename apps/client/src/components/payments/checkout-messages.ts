import type { RejectionReason } from '../../../common-lib/payments/purchase-states.ts';
import { REFUND_REASON_TEXTS } from '../../../common-lib/payments/refund-reason-texts.ts';
import type {
  CheckoutRejectionReason,
  PurchaseKind,
} from '../../graphql/generated/graphql.ts';

export const CHECKOUT_PAGE_TITLE = 'お支払い';

export const CHECKOUT_SUMMARY_TITLE = '購入の内容';

export const CHECKOUT_ITEM_LABEL = '購入';

export const CHECKOUT_QUANTITY_LABEL = '分量';

export const CHECKOUT_PRICE_LABEL = '販売価格(税込)';

export const CHECKOUT_PAYMENT_METHOD_LABEL = '支払方法';

export const CHECKOUT_PAYMENT_METHODS =
  'クレジットカード・デビットカード、Apple Pay、Google Pay、Link';

export const CHECKOUT_PAYMENT_TIMING_LABEL = '支払時期';

export const ONE_TIME_PAYMENT_TIMING =
  'この画面で支払いを確定した時にお支払いいただきます。';

export const SUBSCRIPTION_PAYMENT_TIMING =
  'この画面で支払いを確定した時に初回分をお支払いいただき、以降は毎月の更新日に自動でお支払いいただきます。';

export const CHECKOUT_SERVICE_TIMING_LABEL = '役務の提供時期';

export const CHECKOUT_CONDITIONS_TITLE = '購入の条件';

export const CHECKOUT_DEADLINE_LABEL = '受付期限';

export const CHECKOUT_DEADLINE_DESCRIPTION =
  'この日時を過ぎると、この購入のお支払いは受け付けられません。';

export const REFUND_POLICY_TITLE = '返金ポリシー';

export const CHECKOUT_PAYMENT_TITLE = 'お支払い情報';

export const CONSENT_REQUIRED_SUFFIX = '(必須)';

export const PAY_LABEL = '支払いを確定する';

export const PAY_PENDING_LABEL = '送信中';

export const PAYMENT_UNAVAILABLE_REASON =
  '決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';

export const CHECKOUT_COMPLETED_MESSAGE =
  'この購入のお支払いは完了しています。';

export const CHECKOUT_PROCESSING_MESSAGE =
  'お支払いを確認しています。確認が済むと、決済履歴に記録されます。';

export const CHECKOUT_REFUNDING_MESSAGE =
  '購入を確定できなかったため、お支払いいただいた金額の全額を返金します。';

const REFUND_REASON_PREFIX = '返金の理由: ';

const REJECTION_REASONS_OF: Readonly<
  Record<CheckoutRejectionReason, RejectionReason>
> = Object.freeze({
  LATE: 'late',
  INELIGIBLE: 'ineligible',
  DUPLICATE: 'duplicate',
});

// 自動返金の通知メールと同じく、「返金の理由: 」に続けて共用部品の理由の文を示す
export const refundReasonTextOf = (reason: CheckoutRejectionReason): string =>
  `${REFUND_REASON_PREFIX}${REFUND_REASON_TEXTS[REJECTION_REASONS_OF[reason]]}`;

export const CHECKOUT_EXPIRED_MESSAGE =
  '決済の有効期限が切れたため、購入は完了していません。';

export const CHECKOUT_CLOSED_MESSAGE =
  '受付期限を過ぎたため、この購入はやり直せません。';

export const RESTART_CHECKOUT_LABEL = '決済をやり直す';

export const CHECKOUT_NOT_FOUND_MESSAGE =
  'お探しの決済は見つかりませんでした。';

export const CHECKOUT_NOT_FOUND_DESCRIPTION =
  'URLをご確認ください。これまでのお支払いは決済履歴で確認できます。';

export const BILLING_HISTORY_HREF = '/settings/billing';

export const BILLING_HISTORY_LINK_LABEL = '決済履歴を見る';

export const CHECKOUT_RETURN_PAGE_TITLE = 'お支払いの結果';

export const CHECKOUT_RETURN_CONFIRMING_MESSAGE =
  'お支払いの結果を確認しています。';

export const CHECKOUT_RETURN_COMPLETED_MESSAGE =
  'お支払いを確認し、購入が確定しました。';

export const CHECKOUT_RETURN_PROCESSING_NOTE =
  '確認が済むと、この画面の表示が切り替わります。';

export const CHECKOUT_RETURN_DELAYED_MESSAGE =
  'お支払いの確認に時間がかかっています。しばらくしてから、決済履歴でお支払いの記録をご確認ください。';

export const CHECKOUT_RETURN_INCOMPLETE_MESSAGE =
  'お支払いが完了していないため、購入は完了していません。';

export const CHECKOUT_PAID_AMOUNT_LABEL = 'お支払い金額(税込)';

export interface PurchasedDestination {
  readonly href: string;
  readonly label: string;
}

const PRODUCTS_DESTINATION: PurchasedDestination = Object.freeze({
  href: '/my/products',
  label: 'プロダクト管理を見る',
});

// 購入の完了の後に、購入した対象を確かめられる画面。疎通確認の購入は対象の画面を持たない
export const PURCHASED_DESTINATIONS: Readonly<
  Record<PurchaseKind, PurchasedDestination | undefined>
> = Object.freeze({
  WEEK_TOURNAMENT_ENTRY: PRODUCTS_DESTINATION,
  YEAR_TOURNAMENT_ENTRY: PRODUCTS_DESTINATION,
  SPONSORSHIP: Object.freeze({
    href: '/settings/sponsorships',
    label: 'スポンサー広告を見る',
  }),
  ULTRAS: Object.freeze({ href: '/settings/plan', label: 'プランを見る' }),
  PAYMENTS_SMOKE: undefined,
});

// やり直しは購入種別ごとの申込みの画面から行う。トーナメントの参加費はプロダクト管理、広告とUltrasは料金ページ、疎通確認は決済履歴の開始のボタンから始める
export const CHECKOUT_RESTART_HREFS: Readonly<Record<PurchaseKind, string>> =
  Object.freeze({
    WEEK_TOURNAMENT_ENTRY: '/my/products',
    YEAR_TOURNAMENT_ENTRY: '/my/products',
    SPONSORSHIP: '/pricing',
    ULTRAS: '/pricing',
    PAYMENTS_SMOKE: BILLING_HISTORY_HREF,
  });
