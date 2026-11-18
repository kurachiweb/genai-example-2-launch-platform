import type { YearFinalDateSource } from '../../graphql/generated/graphql.ts';

export const FINAL_DATE_SECTION_TITLE = 'Yearトーナメントの決勝実施日';

export const FINAL_DATE_SECTION_DESCRIPTION =
  '欧州サッカーのリーグ最終節に合わせて、各年の決勝実施日(日曜日)を設定します。未設定の年は5月の最終日曜日に行います。';

export const FINAL_DATE_LABEL = '決勝実施日';

export const FINAL_DATE_ACCEPT_UNTIL_LABEL = '受付期限';

export const FINAL_DATE_DRAW_AT_LABEL = '組み合わせ決定';

export const FINAL_DATE_CHANGE_LOCK_AT_LABEL = '変更期限';

export const FINAL_DATE_UPDATED_AT_LABEL = '最後に変更した日時';

export const FINAL_DATE_UPDATED_BY_LABEL = '変更した管理者';

export const FINAL_DATE_NONE_LABEL = 'なし';

export const FINAL_DATE_SOURCE_LABELS: Readonly<
  Record<YearFinalDateSource, string>
> = Object.freeze({
  EXPLICIT: '設定済み',
  DEFAULT: '既定(5月の最終日曜日)',
});

export const FINAL_DATE_SUPER_ADMIN_ONLY_NOTICE =
  '最上位管理者だけが変更できます。';

export const FINAL_DATE_LOCKED_NOTICE =
  '変更期限(決勝の7日前)を過ぎたため変更できません。';

export const FINAL_DATE_LOCKED_MESSAGE =
  '決勝実施日の7日前を過ぎたため変更できません。';

export const FINAL_DATE_VERSION_CONFLICT_MESSAGE =
  '他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。';

export const FINAL_DATE_VIOLATION_REASONS = Object.freeze([
  'year_not_editable',
  'not_sunday',
  'out_of_year',
  'too_soon',
  'too_far_from_previous',
  'too_far_from_next',
] as const);

export type FinalDateViolationReason =
  (typeof FINAL_DATE_VIOLATION_REASONS)[number];

export const isFinalDateViolationReason = (
  code: string | undefined,
): code is FinalDateViolationReason =>
  FINAL_DATE_VIOLATION_REASONS.some((reason) => reason === code);

export interface FinalDateNeighbors {
  readonly previousYearFinalDate: string | null;
  readonly nextYearFinalDate: string | null;
}

const BUSINESS_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const;

// 決勝実施日は翌年のこともあるため閲覧の年によらず年と曜日を付ける。業務日付の暦日のまま示し、閲覧者のタイムゾーンで日をずらさない
export const formatFinalDateLabel = (date: string): string => {
  const groups = BUSINESS_DATE_PATTERN.exec(date)?.groups;
  if (groups === undefined) {
    throw new RangeError(`業務日付の形でない値です: ${date}`);
  }
  const year = Number(groups.year);
  const month = Number(groups.month);
  const day = Number(groups.day);
  const weekday =
    WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${String(year)}年${String(month)}月${String(day)}日(${weekday ?? ''})`;
};

export const yearLabelOf = (year: number): string => `${String(year)}年`;

export const nextYearGapWarningOf = (nextYearDefaultDate: string): string =>
  `翌年の決勝実施日が未設定のため、既定の${formatFinalDateLabel(nextYearDefaultDate)}では64週以上空きます。参加数を64以下に保つため、翌年の決勝実施日を設定してください。`;

const neighborLabelOf = (date: string | null): string =>
  date === null ? '' : formatFinalDateLabel(date);

export const finalDateViolationMessageOf = (
  reason: FinalDateViolationReason,
  neighbors: FinalDateNeighbors,
): string => {
  switch (reason) {
    case 'year_not_editable':
      return '現在の年か翌年を選んでください。';
    case 'not_sunday':
      return '日曜日を選んでください。';
    case 'out_of_year':
      return '対象年の日付を選んでください。';
    case 'too_soon':
      return '現在から8日後以降の日付を選んでください。';
    case 'too_far_from_previous':
      return `前年の決勝実施日(${neighborLabelOf(neighbors.previousYearFinalDate)})から64週以上空く日付は選べません。`;
    case 'too_far_from_next':
      return `翌年の決勝実施日(${neighborLabelOf(neighbors.nextYearFinalDate)})まで64週以上空く日付は選べません。`;
  }
};

export const FINAL_DATE_NO_CHOICES_MESSAGE = '選べる日付がありません。';

export const FINAL_DATE_SUBMIT_LABEL = '保存する';

export const FINAL_DATE_CONFIRM_LABEL = '保存する';

export const FINAL_DATE_SAVED_MESSAGE = '決勝実施日を保存しました。';

export const finalDateConfirmTitleOf = (year: number, date: string): string =>
  `${yearLabelOf(year)}の決勝実施日を${formatFinalDateLabel(date)}に変更しますか?`;

export interface FinalDateScheduleLabels {
  readonly acceptUntil: string;
  readonly drawAt: string;
}

export const finalDateConfirmDescriptionOf = ({
  acceptUntil,
  drawAt,
}: FinalDateScheduleLabels): string =>
  `受付期限は${acceptUntil}、組み合わせ決定は${drawAt}になり、対象となるWeek優勝の期間も変わります。`;
