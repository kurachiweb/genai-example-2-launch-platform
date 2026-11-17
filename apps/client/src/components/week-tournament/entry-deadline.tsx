import { TimerIcon } from 'lucide-react';

import { RelativeTime } from '../../../lib/components/datetime/relative-time.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import {
  COUNTDOWN_PLACEHOLDER,
  countdownDigitsOf,
} from '../match/full-time-countdown-text.ts';
import { useServerCountdown } from '../match/use-server-countdown.ts';
import {
  ENTRY_COUNTDOWN_LABEL,
  ENTRY_COUNTDOWN_NAME,
  ENTRY_DEADLINE_LABEL,
} from '../tournament/tournament-copy.ts';
import {
  entryCountdownReadingOf,
  isEntryDeadlineUrgent,
} from './week-entry-model.ts';

export interface EntryDeadlineProps {
  // 決済の開始の受付期限(23:00、ISO形式の日時文字列)
  readonly acceptUntil: string;
  // 取得の結果のサーバーの時刻(ISO形式の日時文字列)
  readonly serverTime: string;
  // ページの「自動更新」の状態。偽の間は毎秒の秒読みを止めて描かない
  readonly autoRefresh: boolean;
}

function EntryCountdown({
  acceptUntil,
  serverTime,
}: Omit<EntryDeadlineProps, 'autoRefresh'>) {
  const remainingSeconds = useServerCountdown(acceptUntil, serverTime, true);
  const reading =
    remainingSeconds === null
      ? null
      : entryCountdownReadingOf(remainingSeconds);
  const digits =
    remainingSeconds === null
      ? COUNTDOWN_PLACEHOLDER
      : countdownDigitsOf(remainingSeconds);
  return (
    <div
      role="timer"
      aria-label={ENTRY_COUNTDOWN_NAME}
      className="mt-2 flex items-center gap-2 rounded-lg bg-warning/20 px-2.5 py-1.5 text-warning-strong"
    >
      <TimerIcon aria-hidden="true" className="size-4 shrink-0" />
      {/* 読み上げの文が無いハイドレーションの前は、ラベルを支援技術から隠さない */}
      <span
        aria-hidden={reading === null ? undefined : true}
        className="text-xs font-bold"
      >
        {ENTRY_COUNTDOWN_LABEL}
      </span>
      <span
        aria-hidden="true"
        data-countdown-digits=""
        className="font-display text-xl leading-none font-extrabold tabular-nums"
      >
        {digits}
      </span>
      {reading !== null && (
        <span aria-live="off" data-countdown-reading="" className="sr-only">
          {reading}
        </span>
      )}
    </div>
  );
}

// 受付期限まで48時間未満は日時を注意色で強調し、自動更新がオンの間だけ時:分:秒の秒読みを添える。強調はアイコンと秒読みの文言でも示し、色だけに頼らない
export function EntryDeadline({
  acceptUntil,
  serverTime,
  autoRefresh,
}: EntryDeadlineProps) {
  const urgent = isEntryDeadlineUrgent(acceptUntil, serverTime);
  return (
    <div>
      <p className="text-xs font-bold text-muted-foreground">
        {ENTRY_DEADLINE_LABEL}
      </p>
      <p
        data-entry-deadline-time=""
        className={cn(
          'mt-0.5 flex items-center gap-1 text-sm font-bold',
          urgent && 'text-warning-strong',
        )}
      >
        {urgent && <TimerIcon aria-hidden="true" className="size-4 shrink-0" />}
        <span>
          <RelativeTime
            target={acceptUntil}
            kind="remaining"
            format="dateTime"
          />
        </span>
      </p>
      {urgent && autoRefresh && (
        <EntryCountdown acceptUntil={acceptUntil} serverTime={serverTime} />
      )}
    </div>
  );
}
