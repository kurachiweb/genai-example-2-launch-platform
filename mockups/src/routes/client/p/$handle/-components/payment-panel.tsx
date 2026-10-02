import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  TimerIcon,
  TrophyIcon,
} from 'lucide-react';

import { Button } from '#/components/ui/button';
import { formatCountdown } from '#/lib/countdown';
import { useDateTimeFormatter } from '#/lib/date-format';
import { formatRemaining } from '#/lib/relative-time';
import { cn } from '#/lib/utils';

import { usePageContext } from './page-context';
import { useMockCountdown } from './use-mock-countdown';

type Props = {
  kind: 'week' | 'year';
  deadline: Date;
  urgent: boolean;
  exempt: boolean;
  degraded: boolean;
  showUltrasLink: boolean;
};

// 参考価格(料金及びプラン体系)
const ENTRY_FEES = { week: '$5', year: '$20' } as const;

export function PaymentPanel({
  kind,
  deadline,
  urgent,
  exempt,
  degraded,
  showUltrasLink,
}: Props) {
  const { now } = usePageContext();
  const formatter = useDateTimeFormatter(
    kind === 'year' ? 'longDateTime' : 'dateTime',
  );
  const countdown = useMockCountdown(deadline, now);
  const tournament = kind === 'week' ? 'Weekトーナメント' : 'Yearトーナメント';

  if (exempt) {
    return (
      <div className="rounded-xl border border-primary/30 bg-card p-3">
        <p className="flex items-center gap-1.5 text-sm font-extrabold text-primary">
          <BadgeCheckIcon className="size-4" aria-hidden="true" />
          参加費免除
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          <span translate="no">Ultras</span>
          の特典により{tournament}
          の参加資格を得ています。参加のための操作は不要です。
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-3',
        urgent ? 'border-warning ring-2 ring-warning/40' : 'border-border',
      )}
    >
      <p className="text-xs font-bold text-muted-foreground">決済期限</p>
      <p
        className={cn(
          'mt-0.5 text-sm font-bold',
          urgent && 'text-warning-strong',
        )}
      >
        <time dateTime={deadline.toISOString()}>
          {formatter.format(deadline)}
        </time>
        <span className="ml-1 font-normal">
          ({formatRemaining(deadline, now)})
        </span>
      </p>
      {urgent && (
        <p
          className="mt-2 flex items-center gap-2 rounded-lg bg-warning/20 px-2.5 py-1.5 text-warning-strong"
          role="timer"
          aria-label="決済期限までの残り時間"
        >
          <TimerIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="text-xs font-bold">締め切りまであと</span>
          <span className="scoreboard-digits text-xl leading-none">
            {countdown ? formatCountdown(countdown) : '--:--:--'}
          </span>
        </p>
      )}
      <Button
        className="mt-3 h-auto w-full flex-col gap-0 py-2 whitespace-normal"
        size="lg"
        disabled={degraded}
        aria-describedby={degraded ? `${kind}-payment-unavailable` : undefined}
      >
        <span className="inline-flex items-center gap-2">
          <TrophyIcon aria-hidden="true" />
          {tournament}に参加
        </span>
        <span className="text-xs font-normal opacity-85">
          参加費 {ENTRY_FEES[kind]}
        </span>
      </Button>
      {degraded && (
        <div
          id={`${kind}-payment-unavailable`}
          role="status"
          className="mt-2 flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs"
        >
          <AlertTriangleIcon
            className="size-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <p>
            <strong className="block font-bold">
              現在ご利用いただけません。
            </strong>
            決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。
          </p>
        </div>
      )}
      {showUltrasLink && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span translate="no">Ultras</span>
          なら参加費が免除され、敗北後は2日で再ローンチできます。
          <a href="#" className="ml-1 font-semibold text-primary">
            料金を見る
          </a>
        </p>
      )}
    </div>
  );
}
