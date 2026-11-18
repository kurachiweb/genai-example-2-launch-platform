import type {
  TournamentEntryCopy,
  TournamentEntryExcludedReason,
} from '../tournament/tournament-copy.ts';
import { YEAR_TOURNAMENT_SECTION_TITLE } from './year-tournament-messages.ts';

export const YEAR_ENTRY_BUTTON_LABEL = 'Yearトーナメントに参加';

export const YEAR_ENTRY_EXEMPT_MESSAGE =
  'Ultrasの特典によりYearトーナメントの参加資格を得ています。参加のための操作は不要です。';

export const YEAR_ENTRY_CLOSED_MESSAGE =
  'Yearトーナメントの参加受付は終了しました。';

// 「組み合わせは<日時>に決定します。」の日時の前後の文言
export const YEAR_ENTRY_ENTITLED_MESSAGE = Object.freeze({
  lead: '参加資格を得ました。',
  before: '組み合わせは',
  after: 'に決定します。',
});

export const YEAR_ENTRY_DRAWN_MESSAGE = '組み合わせに参加しています。';

export const yearEntryEliminatedMessage = (roundName: string): string =>
  `${roundName}で敗退しました。`;

export const YEAR_ENTRY_CHAMPION_MESSAGE =
  'Product of the Yearを受賞しました。';

export const YEAR_ENTRY_EXPIRED_MESSAGE =
  '決済期限までに参加費の決済が無かったため参加できませんでした。';

export const YEAR_ENTRY_LATE_ENTRY_MESSAGE =
  '組み合わせ決定の後にWeek優勝が反映されたため参加できませんでした。';

export const YEAR_ENTRY_FORFEITED_MESSAGE =
  'プロダクトの削除により参加資格を失いました。';

export const YEAR_ENTRY_EXCLUDED_HIDDEN_MESSAGE =
  '組み合わせ決定の時点でプロダクトが公開されていなかったため参加できませんでした。';

export const YEAR_ENTRY_EXCLUDED_OVER_CAPACITY_MESSAGE =
  '参加数の上限(64)を超えたため参加できませんでした。';

export const YEAR_ENTRY_REFUND_MESSAGE = '参加費は自動で全額返金されます。';

export const YEAR_ENTRY_DELETE_NOTICE =
  'このプロダクトを削除するとYearトーナメントの参加資格を失います。支払った参加費は自動で全額返金されます。';

// 「<週の表記>のProduct of the Week受賞により、<年>年のYearトーナメントに参加できます。決勝は<決勝日>です。」の決勝日の前後の文言
export const yearEntryIntroMessage = (
  weekLabel: string,
  yearLabel: string,
): { readonly before: string; readonly after: string } =>
  Object.freeze({
    before: `${weekLabel}のProduct of the Week受賞により、${yearLabel}のYearトーナメントに参加できます。決勝は`,
    after: 'です。',
  });

const excludedMessageOf = (reason: TournamentEntryExcludedReason): string =>
  reason === 'over_capacity'
    ? YEAR_ENTRY_EXCLUDED_OVER_CAPACITY_MESSAGE
    : YEAR_ENTRY_EXCLUDED_HIDDEN_MESSAGE;

export const YEAR_ENTRY_COPY: TournamentEntryCopy = Object.freeze({
  title: YEAR_TOURNAMENT_SECTION_TITLE,
  entryButton: YEAR_ENTRY_BUTTON_LABEL,
  exemptMessage: YEAR_ENTRY_EXEMPT_MESSAGE,
  closedMessage: YEAR_ENTRY_CLOSED_MESSAGE,
  entitledMessage: YEAR_ENTRY_ENTITLED_MESSAGE,
  drawnMessage: YEAR_ENTRY_DRAWN_MESSAGE,
  championMessage: YEAR_ENTRY_CHAMPION_MESSAGE,
  eliminatedMessage: yearEntryEliminatedMessage,
  expiredMessage: (late: boolean) =>
    late ? YEAR_ENTRY_LATE_ENTRY_MESSAGE : YEAR_ENTRY_EXPIRED_MESSAGE,
  forfeitedMessage: YEAR_ENTRY_FORFEITED_MESSAGE,
  forfeitedRefundSuffix: YEAR_ENTRY_REFUND_MESSAGE,
  excludedMessage: excludedMessageOf,
  excludedRefundSuffix: YEAR_ENTRY_REFUND_MESSAGE,
});
