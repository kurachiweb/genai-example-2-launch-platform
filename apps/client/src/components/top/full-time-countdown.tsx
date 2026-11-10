import { ClockIcon } from 'lucide-react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { useServerCountdown } from '../match/use-server-countdown.ts';
import {
  COUNTDOWN_END_SUFFIX,
  COUNTDOWN_LABEL,
  COUNTDOWN_PLACEHOLDER,
  COUNTDOWN_REGION_LABEL,
  countdownDigitsOf,
  countdownReadingOf,
} from './full-time-countdown-text.ts';

export interface FullTimeCountdownProps {
  readonly phase: 'LIVE' | 'RESULT';
  // 終了の時刻(ISO形式の日時文字列)
  readonly fullTimeAt: string;
  // 取得の結果のサーバーの時刻(ISO形式の日時文字列)
  readonly serverTime: string;
  readonly autoRefresh: boolean;
}

// 自動更新がオフの間は毎秒の更新を止めてラベルと残り時間を出さず、終了の時刻だけを残す。支援技術には毎秒の数字を読ませず、分単位の文言を通知しない領域で持つ
export function FullTimeCountdown({
  phase,
  fullTimeAt,
  serverTime,
  autoRefresh,
}: FullTimeCountdownProps) {
  const running = autoRefresh && phase === 'LIVE';
  const remainingSeconds = useServerCountdown(fullTimeAt, serverTime, running);
  if (phase !== 'LIVE') {
    return null;
  }
  const reading =
    remainingSeconds === null ? null : countdownReadingOf(remainingSeconds);
  const digits =
    remainingSeconds === null
      ? COUNTDOWN_PLACEHOLDER
      : countdownDigitsOf(remainingSeconds);
  return (
    <section
      aria-label={COUNTDOWN_REGION_LABEL}
      className="@container flex items-center justify-center rounded-xl border border-border bg-card p-2 text-card-foreground shadow-sm sm:p-3"
    >
      <p className="flex flex-col items-center gap-1 text-center">
        {autoRefresh && (
          <>
            <span
              aria-hidden={reading === null ? undefined : true}
              className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground"
            >
              {/* カードの幅が狭いとラベルが単語の途中で折り返されるため、アイコンを隠して1行に収める */}
              <ClockIcon
                className="size-3.5 @max-[9rem]:hidden"
                aria-hidden="true"
              />
              {COUNTDOWN_LABEL}
            </span>
            {/* 置かれる列の幅が画面の幅や列の数で変わるため、数字の大きさはカードの幅に比例させて1行に収める */}
            <span
              aria-hidden="true"
              data-countdown-digits=""
              className="font-display text-[clamp(1.5rem,22cqi,2.5rem)] leading-none font-extrabold tracking-tight text-primary tabular-nums"
            >
              {digits}
            </span>
          </>
        )}
        {reading !== null && (
          <span aria-live="off" data-countdown-reading="" className="sr-only">
            {reading}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          (<DateTime value={fullTimeAt} format="time" />
          {COUNTDOWN_END_SUFFIX})
        </span>
      </p>
    </section>
  );
}
