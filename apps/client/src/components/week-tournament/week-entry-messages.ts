import type { TournamentEntryCopy } from '../tournament/tournament-copy.ts';
import { WEEK_TOURNAMENT_SECTION_TITLE } from './week-tournament-messages.ts';

export const WEEK_ENTRY_BUTTON_LABEL = 'Weekトーナメントに参加';

export const WEEK_ENTRY_EXEMPT_MESSAGE =
  'Ultrasの特典によりWeekトーナメントの参加資格を得ています。参加のための操作は不要です。';

export const WEEK_ENTRY_CLOSED_MESSAGE =
  'Weekトーナメントの参加受付は終了しました。';

// 「組み合わせは<日時>に決定します。」の日時の前後の文言
export const WEEK_ENTRY_ENTITLED_MESSAGE = Object.freeze({
  lead: '参加資格を得ました。',
  before: '組み合わせは',
  after: 'に決定します。',
});

export const WEEK_ENTRY_DRAWN_MESSAGE = '組み合わせに参加しています。';

export const weekEntryEliminatedMessage = (roundName: string): string =>
  `${roundName}で敗退しました。`;

export const WEEK_ENTRY_CHAMPION_MESSAGE =
  'Product of the Weekを受賞しました。';

export const WEEK_ENTRY_EXPIRED_MESSAGE =
  '決済期限までに参加費の決済が無かったため参加できませんでした。';

export const WEEK_ENTRY_LATE_ENTRY_MESSAGE =
  '予選の勝利が組み合わせ決定に間に合わなかったため参加できませんでした。';

export const WEEK_ENTRY_FORFEITED_MESSAGE =
  '組み合わせ決定前にプロダクトが削除されたため参加資格を失いました。';

export const WEEK_ENTRY_FORFEITED_REFUND_MESSAGE =
  '支払った参加費は自動で全額返金されます。';

export const WEEK_ENTRY_EXCLUDED_MESSAGE =
  '組み合わせ決定の時点でプロダクトが公開されていなかったため参加できませんでした。';

export const WEEK_ENTRY_EXCLUDED_REFUND_MESSAGE = '参加費は返金されます。';

export const WEEK_ENTRY_DELETE_NOTICE =
  'このプロダクトを削除するとWeekトーナメントの参加資格を失います。支払った参加費は自動で全額返金されます。';

// Weekに参加数の上限は無く、除外の理由はプロダクトが公開されていないことだけ
export const WEEK_ENTRY_COPY: TournamentEntryCopy = Object.freeze({
  title: WEEK_TOURNAMENT_SECTION_TITLE,
  entryButton: WEEK_ENTRY_BUTTON_LABEL,
  exemptMessage: WEEK_ENTRY_EXEMPT_MESSAGE,
  closedMessage: WEEK_ENTRY_CLOSED_MESSAGE,
  entitledMessage: WEEK_ENTRY_ENTITLED_MESSAGE,
  drawnMessage: WEEK_ENTRY_DRAWN_MESSAGE,
  championMessage: WEEK_ENTRY_CHAMPION_MESSAGE,
  eliminatedMessage: weekEntryEliminatedMessage,
  expiredMessage: (late: boolean) =>
    late ? WEEK_ENTRY_LATE_ENTRY_MESSAGE : WEEK_ENTRY_EXPIRED_MESSAGE,
  forfeitedMessage: WEEK_ENTRY_FORFEITED_MESSAGE,
  forfeitedRefundSuffix: WEEK_ENTRY_FORFEITED_REFUND_MESSAGE,
  excludedMessage: () => WEEK_ENTRY_EXCLUDED_MESSAGE,
  excludedRefundSuffix: WEEK_ENTRY_EXCLUDED_REFUND_MESSAGE,
});
