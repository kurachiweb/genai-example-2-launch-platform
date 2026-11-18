import { CONTACT_LABEL } from '../../../lib/utilities/messages/state-messages.ts';
import type { SponsorshipDateUnavailableReason } from '../../../common-lib/sponsorship/sponsorship-period.ts';
import {
  SPONSORSHIP_TIER_LABELS,
  type SponsorshipTier,
} from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { MY_PRODUCTS_LINK, PRICING_HREF } from '../layout/site-links.ts';

export const SPONSORSHIP_PRICING_SECTION_TITLE = 'スポンサー広告';

export const SPONSORSHIP_PRICING_SECTION_ID = 'sponsorship';

export const SPONSORSHIP_APPLY_HREF = `${PRICING_HREF}#${SPONSORSHIP_PRICING_SECTION_ID}`;

export const SPONSORSHIP_APPLY_LINK_LABEL = 'スポンサー広告を申し込む';

export const sponsorshipPlacementLabel = (tier: SponsorshipTier): string =>
  `${SPONSORSHIP_TIER_LABELS[tier]}スポンサー広告`;

export const sponsoredAdLinkLabel = (productName: string): string =>
  `${productName}のサイトを別タブで開く(スポンサー広告)`;

// 「<金額>/日」の金額の後の文言
export const SPONSORSHIP_PRICE_PER_DAY_SUFFIX = '/日';

export const SPONSORSHIP_PRICE_UNAVAILABLE_MESSAGE = '現在表示できません';

export const SPONSORSHIP_TIER_POSITIONS: Readonly<
  Record<SponsorshipTier, string>
> = Object.freeze({
  legend: '各ページの上部に大きく表示',
  gold: 'メインコンテンツの横と一覧の間に表示',
  silver: 'ページの下部に表示',
});

export const SPONSORSHIP_TIER_CONTENTS: Readonly<
  Record<SponsorshipTier, string>
> = Object.freeze({
  legend: 'ロゴ・名称・タグライン',
  gold: 'ロゴ・名称・タグライン',
  silver: 'ロゴ・名称',
});

export const SPONSORSHIP_FORM_LABELS = Object.freeze({
  product: 'プロダクト(必須)',
  productPlaceholder: '選択してください',
  tier: 'ティア(必須)',
  startsOn: '開始日(必須)',
  endsOn: '終了日(必須)',
  days: '日数',
  total: '合計(税込)',
});

export const sponsorshipDaysLabel = (days: number): string =>
  `${String(days)}日間`;

export const SPONSORSHIP_NO_ELIGIBLE_PRODUCTS_MESSAGE =
  'スポンサー広告を申し込めるプロダクトがありません。ローンチ日を迎えたプロダクトから選べます。';

export const MY_PRODUCTS_LINK_LABEL = '自分のプロダクトを見る';

export const MY_PRODUCTS_LINK_HREF = MY_PRODUCTS_LINK.href;

export const SPONSORSHIP_APPLY_SUBMIT_LABEL = '申し込む';

export const SPONSORSHIP_SUBMIT_PENDING_LABEL = '送信中';

export const SPONSORSHIP_LOGIN_TO_APPLY_LABEL = 'ログインして申し込む';

export const SPONSORSHIP_EMAIL_UNVERIFIED_REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

export const SPONSORSHIP_ACCOUNT_SUSPENDED_REASON =
  'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。';

const START_DATE_OUT_OF_RANGE_MESSAGE =
  '開始日は今日から1年以内の日付を選んでください。';

const END_DATE_OUT_OF_RANGE_MESSAGE =
  '終了日は開始日から366日以内の、開始日以降の日付を選んでください。';

// カレンダーの選べない日の理由。範囲の外の理由は開始日の欄と終了日の欄で文言を分け、重なりは両方の欄で同じ文言にする
export const SPONSORSHIP_DATE_REASON_MESSAGES: Readonly<
  Record<SponsorshipDateUnavailableReason, string>
> = Object.freeze({
  past: START_DATE_OUT_OF_RANGE_MESSAGE,
  out_of_range: START_DATE_OUT_OF_RANGE_MESSAGE,
  before_start: END_DATE_OUT_OF_RANGE_MESSAGE,
  too_long: END_DATE_OUT_OF_RANGE_MESSAGE,
  overlap: '同じティアの広告の掲載期間と重なるため選べません。',
});

export type SponsorshipErrorCode =
  | 'sponsorship_product_ineligible'
  | 'sponsorship_overlap'
  | 'sponsorship_not_found'
  | 'sponsorship_not_payable'
  | 'sponsorship_period_invalid';

export const SPONSORSHIP_ERROR_MESSAGES: Readonly<
  Record<SponsorshipErrorCode, string>
> = Object.freeze({
  sponsorship_product_ineligible:
    'このプロダクトはスポンサー広告を申し込めません。',
  sponsorship_overlap:
    'このプロダクトは選んだ期間に同じティアの広告を掲載中または掲載予定です。期間を変えて申し込んでください。',
  sponsorship_not_found: 'この申込は見つかりませんでした。',
  sponsorship_not_payable:
    '掲載開始日を過ぎたため、この申込は決済できません。新しく申し込んでください。',
  sponsorship_period_invalid:
    'この申込の掲載期間では決済できません。新しく申し込んでください。',
});

const isSponsorshipErrorCode = (code: string): code is SponsorshipErrorCode =>
  Object.hasOwn(SPONSORSHIP_ERROR_MESSAGES, code);

// 本specの業務のエラーコードの文言を返し、それ以外のコードはnullにして画面が共通の文言を選ぶ
export const sponsorshipErrorMessageOf = (
  code: string | undefined,
): string | null =>
  code !== undefined && isSponsorshipErrorCode(code)
    ? SPONSORSHIP_ERROR_MESSAGES[code]
    : null;

export const MY_SPONSORSHIPS_PAGE_TITLE = 'スポンサー広告';

export const MY_SPONSORSHIPS_HREF = '/settings/sponsorships';

export const SPONSORSHIP_PERIOD_SEPARATOR = '〜';

// 自分の広告一覧の項目名
export const MY_SPONSORSHIP_ITEM_LABELS = Object.freeze({
  period: '掲載期間',
  amountPaid: '支払った金額',
  status: '掲載状況',
});

export const SPONSORSHIP_UNPAID_AMOUNT_TEXT = '—';

export const SPONSORSHIP_PAUSED_NOTICE =
  'プロダクトの公開停止またはアカウントの停止により表示を止めています。掲載期間は延長されず、表示を止めた日数分は掲載の終わりに自動で返金されます。';

export const SPONSORSHIP_TERMINATED_ON_LABEL = '強制終了日';

export const SPONSORSHIP_TERMINATION_REASON_LABEL = '理由';

// 強制終了の未掲載の日数分の返金と、表示停止の日数分の返金
export type SponsorshipRefundKind = 'termination' | 'display_stop';

const REFUND_SUBJECTS: Readonly<Record<SponsorshipRefundKind, string>> =
  Object.freeze({
    termination: '未掲載の',
    display_stop: '表示を止めた',
  });

const refundSubjectOf = (kind: SponsorshipRefundKind, days: number): string =>
  `${REFUND_SUBJECTS[kind]}${String(days)}日分`;

export interface SponsorshipRefundRequestedParts {
  readonly beforeAmount: string;
  readonly afterAmount: string;
}

// 金額は金額の表示部品で示すため、その前後の文を返す。残りの全額で依頼した返金は金額の位置にSPONSORSHIP_REFUND_REMAINING_AMOUNT_LABELを置く
export const sponsorshipRefundRequestedParts = (
  kind: SponsorshipRefundKind,
  days: number,
): SponsorshipRefundRequestedParts => ({
  beforeAmount: refundSubjectOf(kind, days),
  afterAmount: 'を返金します',
});

export const SPONSORSHIP_REFUND_REMAINING_AMOUNT_LABEL = '(残りの全額)';

export const sponsorshipRefundedMessage = (
  kind: SponsorshipRefundKind,
  days: number,
): string => `${refundSubjectOf(kind, days)}は返金済みです`;

// 末尾の「お問い合わせ」を問い合わせの画面へのリンクにする
export const SPONSORSHIP_REFUND_REJECTED_MESSAGE_PARTS = Object.freeze({
  beforeLink: '返金の手続きでお問い合わせが必要です。',
  linkLabel: CONTACT_LABEL,
  afterLink: 'ください。',
});

export const SPONSORED_PRODUCT_DELETED_NAME = '削除したプロダクト';

export const RESUME_SPONSORSHIP_CHECKOUT_LABEL = '決済へ進む';

export const MY_SPONSORSHIPS_EMPTY_MESSAGE =
  'まだスポンサー広告の申込はありません。';

export const MY_SPONSORSHIPS_LOAD_ERROR_MESSAGE =
  'スポンサー広告の一覧を読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

export const MY_SPONSORSHIPS_LOAD_MORE_LABEL = 'さらに表示';

export const MY_SPONSORSHIPS_LOADING_MORE_LABEL = '読み込み中';

export const PRODUCT_SPONSORSHIP_DELETE_NOTICE =
  'このプロダクトの掲載中・掲載予定のスポンサー広告は終了し、返金されません。';
