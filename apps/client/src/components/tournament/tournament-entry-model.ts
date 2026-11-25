import {
  ENTRY_COUNTDOWN_LABEL,
  type TournamentEntryExcludedReason,
} from './tournament-copy.ts';

// 種類の照会の参加の枠の値から、包みが写す種類によらない入力
export interface TournamentEntryInput {
  readonly launchId: string;
  readonly status:
    | 'AWAITING_PAYMENT'
    | 'ENTITLED'
    | 'DRAWN'
    | 'EXPIRED'
    | 'FORFEITED'
    | 'EXCLUDED';
  // 期限切れの理由が組み合わせ決定の後の確定
  readonly late: boolean;
  readonly excludedReason: TournamentEntryExcludedReason | null;
  readonly exempt: boolean;
  // 資格の喪失・除外の文に返金の文を添えるか
  readonly refundable: boolean;
  readonly acceptUntil: string;
  readonly drawAt: string;
  readonly serverTime: string;
  // 参加費(税込のUSDの最小単位)。照会できなければnull
  readonly feeAmount: number | null;
  readonly ultrasGuide: boolean;
  // 受付中で受付期限の前でも決済を始められない理由の文言(サーバーが決済の開始の拒否と同じ文言を返す)
  readonly blockedReason: string | null;
  readonly progress: {
    readonly alive: boolean;
    readonly eliminatedRoundName: string | null;
    readonly champion: boolean;
  } | null;
  readonly bracketPath: string | null;
}

export type TournamentEntryDrawnOutcome =
  | { readonly type: 'alive' }
  | { readonly type: 'champion' }
  | { readonly type: 'eliminated'; readonly roundName: string };

export type TournamentEntryDisplay =
  | {
      readonly kind: 'payable';
      readonly feeAmount: number | null;
      readonly ultrasGuide: boolean;
      readonly blockedReason: string | null;
    }
  | { readonly kind: 'exempt' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'entitled'; readonly drawAt: string }
  | {
      readonly kind: 'drawn';
      readonly outcome: TournamentEntryDrawnOutcome;
      readonly bracketPath: string | null;
    }
  | { readonly kind: 'expired'; readonly late: boolean }
  | { readonly kind: 'forfeited'; readonly refund: boolean }
  | {
      readonly kind: 'excluded';
      readonly reason: TournamentEntryExcludedReason;
      readonly refund: boolean;
    };

const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;

export const ENTRY_URGENT_WINDOW_MS = 48 * HOUR_S * SECOND_MS;

// 参加数の上限を持たない種類の除外は、プロダクトが公開されていないことだけによる
const DEFAULT_EXCLUDED_REASON: TournamentEntryExcludedReason =
  'hidden_or_suspended';

const remainingMsOf = (acceptUntil: string, serverTime: string): number =>
  Date.parse(acceptUntil) - Date.parse(serverTime);

const isAccepting = (entry: TournamentEntryInput): boolean =>
  remainingMsOf(entry.acceptUntil, entry.serverTime) > 0;

export const isEntryDeadlineUrgent = (
  acceptUntil: string,
  serverTime: string,
): boolean => {
  const remaining = remainingMsOf(acceptUntil, serverTime);
  return remaining > 0 && remaining < ENTRY_URGENT_WINDOW_MS;
};

const drawnOutcomeOf = (
  progress: TournamentEntryInput['progress'],
): TournamentEntryDrawnOutcome => {
  if (progress?.champion === true) {
    return { type: 'champion' };
  }
  const roundName = progress?.eliminatedRoundName ?? null;
  return roundName === null
    ? { type: 'alive' }
    : { type: 'eliminated', roundName };
};

const awaitingDisplayOf = (
  entry: TournamentEntryInput,
): TournamentEntryDisplay => {
  if (entry.exempt) {
    return { kind: 'exempt' };
  }
  if (!isAccepting(entry)) {
    return { kind: 'closed' };
  }
  return {
    kind: 'payable',
    feeAmount: entry.feeAmount,
    ultrasGuide: entry.ultrasGuide,
    blockedReason: entry.blockedReason,
  };
};

export function tournamentEntryDisplayOf(
  entry: TournamentEntryInput,
): TournamentEntryDisplay {
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
      return { kind: 'expired', late: entry.late };
    case 'FORFEITED':
      return { kind: 'forfeited', refund: entry.refundable };
    case 'EXCLUDED':
      return {
        kind: 'excluded',
        reason: entry.excludedReason ?? DEFAULT_EXCLUDED_REASON,
        refund: entry.refundable,
      };
  }
}

// 秒読みを持つ間。自動更新の切り替えでは変わらず、ページが切り替えを描くかの判定に使う
export const hasEntryCountdown = (
  entry: TournamentEntryInput | null,
): boolean =>
  entry !== null &&
  tournamentEntryDisplayOf(entry).kind === 'payable' &&
  isEntryDeadlineUrgent(entry.acceptUntil, entry.serverTime);

// 受付期限に受付の終了へ切り替えるため、決済の導線の間だけ受付期限で取り直す。秒読みを添えるときは、注意色と秒読みへ切り替える受付期限の48時間前でも取り直す
export function tournamentEntryBoundariesOf(
  entry: TournamentEntryInput,
  countdown: boolean,
): readonly string[] {
  if (tournamentEntryDisplayOf(entry).kind !== 'payable') {
    return [];
  }
  const acceptUntil = Date.parse(entry.acceptUntil);
  const closing = new Date(acceptUntil).toISOString();
  return countdown
    ? [new Date(acceptUntil - ENTRY_URGENT_WINDOW_MS).toISOString(), closing]
    : [closing];
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
