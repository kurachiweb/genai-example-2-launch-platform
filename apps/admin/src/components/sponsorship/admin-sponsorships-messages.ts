export const SPONSORSHIPS_TITLE = 'スポンサー広告';

export const SPONSORSHIPS_DESCRIPTION =
  '退会者の申込を除くスポンサー広告の申込を、申込日時の新しい順に表示します。';

export const SPONSORSHIP_LIST_CAPTION = 'スポンサー広告の一覧';

export const SPONSORSHIP_LIST_EMPTY_MESSAGE =
  '条件に一致するスポンサー広告の申込はありません。';

export const SPONSORSHIP_LIST_COLUMNS = Object.freeze({
  id: '申込ID',
  product: 'プロダクト',
  applicant: '申込者',
  tier: 'ティア',
  period: '掲載期間',
  amountPaid: '支払った金額',
  status: '掲載状況',
  createdAt: '申込日時',
  actions: '操作',
});

export const DELETED_PRODUCT_LABEL = '削除済みのプロダクト';

export const UNREADABLE_APPLICANT_LABEL = '表示できない利用者';

export const UNPAID_AMOUNT_TEXT = '—';

export const SPONSORSHIP_PERIOD_SEPARATOR = '〜';

export const sponsorshipDaysLabel = (days: number): string =>
  `${String(days)}日間`;

export const TERMINATE_LABEL = '強制終了';

export const terminateButtonName = (id: string): string =>
  `申込${id}を強制終了`;

export const STATUS_FILTER_LABEL = '掲載状況';

export const ALL_STATUSES_LABEL = 'すべての掲載状況';

export const TIER_FILTER_LABEL = 'ティア';

export const ALL_TIERS_LABEL = 'すべてのティア';
