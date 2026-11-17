import type { ClientMyWeekEntryQuery } from '../../graphql/generated/graphql.ts';
import { ENTRY_COUNTDOWN_LABEL } from './week-entry-messages.ts';

export type WeekEntryPanelView = NonNullable<
  ClientMyWeekEntryQuery['myWeekEntry']
>;

export type WeekEntryDrawnOutcome =
  | { readonly type: 'alive' }
  | { readonly type: 'champion' }
  | { readonly type: 'eliminated'; readonly roundName: string };

export type WeekEntryDisplay =
  | {
      readonly kind: 'payable';
      readonly feeAmount: number | null;
      readonly ultrasGuide: boolean;
      // 受付中で受付期限の前でも決済を始められない理由の文言(サーバーが決済の開始の拒否と同じ文言を返す)
      readonly blockedReason: string | null;
    }
  | { readonly kind: 'exempt' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'entitled'; readonly drawAt: string }
  | {
      readonly kind: 'drawn';
      readonly outcome: WeekEntryDrawnOutcome;
      readonly bracketPath: string | null;
    }
  | { readonly kind: 'expired'; readonly late: boolean }
  | { readonly kind: 'forfeited'; readonly refund: boolean }
  | { readonly kind: 'excluded'; readonly refund: boolean };

const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;

export const ENTRY_URGENT_WINDOW_MS = 48 * HOUR_S * SECOND_MS;

const remainingMsOf = (acceptUntil: string, serverTime: string): number =>
  Date.parse(acceptUntil) - Date.parse(serverTime);

const isAccepting = (entry: WeekEntryPanelView): boolean =>
  remainingMsOf(entry.acceptUntil, entry.serverTime) > 0;

export const isEntryDeadlineUrgent = (
  acceptUntil: string,
  serverTime: string,
): boolean => {
  const remaining = remainingMsOf(acceptUntil, serverTime);
  return remaining > 0 && remaining < ENTRY_URGENT_WINDOW_MS;
};

const drawnOutcomeOf = (
  progress: WeekEntryPanelView['progress'],
): WeekEntryDrawnOutcome => {
  if (progress?.champion === true) {
    return { type: 'champion' };
  }
  const roundName = progress?.eliminatedRoundName ?? null;
  return roundName === null
    ? { type: 'alive' }
    : { type: 'eliminated', roundName };
};

const awaitingDisplayOf = (entry: WeekEntryPanelView): WeekEntryDisplay => {
  if (entry.exempt) {
    return { kind: 'exempt' };
  }
  if (!isAccepting(entry)) {
    return { kind: 'closed' };
  }
  return {
    kind: 'payable',
    feeAmount: entry.fee?.amount ?? null,
    ultrasGuide: entry.ultrasGuide,
    blockedReason: entry.checkoutBlock?.message ?? null,
  };
};

// Ultrasの特典で免除された枠は参加費を決済していないため、返金の文を添えない
export function weekEntryDisplayOf(
  entry: WeekEntryPanelView,
): WeekEntryDisplay {
  switch (entry.status) {
    case 'AWAITING_PAYMENT':
      return awaitingDisplayOf(entry);
    case 'ENTITLED':
      return entry.exempt
        ? { kind: 'exempt' }
        : { kind: 'entitled', drawAt: entry.drawAt };
    case 'DRAWN':
      return {
        kind: 'drawn',
        outcome: drawnOutcomeOf(entry.progress),
        bracketPath: entry.bracketPath,
      };
    case 'EXPIRED':
      return { kind: 'expired', late: entry.closeReason === 'LATE_ENTRY' };
    case 'FORFEITED':
      return { kind: 'forfeited', refund: !entry.exempt };
    case 'EXCLUDED':
      return { kind: 'excluded', refund: !entry.exempt };
  }
}

// 秒読みを持つ間。自動更新の切り替えでは変わらず、ページが切り替えを描くかの判定に使う
export const hasEntryCountdown = (entry: WeekEntryPanelView | null): boolean =>
  entry !== null &&
  weekEntryDisplayOf(entry).kind === 'payable' &&
  isEntryDeadlineUrgent(entry.acceptUntil, entry.serverTime);

// 受付期限の48時間前に注意色と秒読みへ、受付期限に受付の終了へ切り替えるため、決済の導線の間だけその2つの時刻で取り直す
export function weekEntryBoundariesOf(
  entry: WeekEntryPanelView,
): readonly string[] {
  if (weekEntryDisplayOf(entry).kind !== 'payable') {
    return [];
  }
  const acceptUntil = Date.parse(entry.acceptUntil);
  return [
    new Date(acceptUntil - ENTRY_URGENT_WINDOW_MS).toISOString(),
    new Date(acceptUntil).toISOString(),
  ];
}

export function entryCountdownReadingOf(remainingSeconds: number): string {
  const hours = Math.floor(remainingSeconds / HOUR_S);
  const minutes = Math.floor((remainingSeconds % HOUR_S) / MINUTE_S);
  if (hours > 0) {
    return `${ENTRY_COUNTDOWN_LABEL}${String(hours)}時間${String(minutes)}分`;
  }
  if (minutes > 0) {
    return `${ENTRY_COUNTDOWN_LABEL}${String(minutes)}分`;
  }
  return `${ENTRY_COUNTDOWN_LABEL}1分未満`;
}

// 組み合わせ決定の前で受付中か参加資格を得た枠だけが、削除で参加資格を失い参加費の返金の対象になる
export const hasWeekEntryDeleteNotice = (
  entry: WeekEntryPanelView | null,
): boolean =>
  entry !== null &&
  (entry.status === 'AWAITING_PAYMENT' || entry.status === 'ENTITLED');
