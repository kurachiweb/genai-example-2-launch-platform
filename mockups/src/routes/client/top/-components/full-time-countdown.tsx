import { ClockIcon } from 'lucide-react';

import { formatCountdown, useCountdown } from '#/lib/countdown';
import { useDateTimeFormatter } from '#/lib/date-format';

import { matchEnd } from '../-model';

export function FullTimeCountdown() {
  const countdown = useCountdown(matchEnd);
  const timeFormatter = useDateTimeFormatter('time');
  const matchEndAt = matchEnd();

  return (
    <section
      aria-label="フルタイムまでの残り時間"
      className="rise-in @container flex items-center justify-center rounded-xl border border-border bg-card p-2 shadow-sm sm:p-3"
    >
      <p className="flex flex-col items-center gap-1 text-center">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
          {/* カード幅が狭いとラベルが単語の途中で折り返されるため、アイコンを隠して1行に収める */}
          <ClockIcon
            className="size-3.5 @max-[9rem]:hidden"
            aria-hidden="true"
          />
          フルタイムまであと
        </span>
        {/* 置かれる列の幅が画面幅や列数で変わるため、数字の大きさはカード幅に比例させて1行に収める */}
        <span
          className="scoreboard-digits text-[clamp(1.5rem,22cqi,2.5rem)] leading-none text-primary"
          aria-hidden="true"
        >
          {countdown ? formatCountdown(countdown) : '--:--:--'}
        </span>
        <time
          dateTime={matchEndAt.toISOString()}
          className="text-xs text-muted-foreground"
        >
          ({timeFormatter.format(matchEndAt)}終了)
        </time>
      </p>
    </section>
  );
}
