import { useId } from 'react';
import { InfoIcon, PencilIcon, RocketIcon } from 'lucide-react';

import { ROUND_LABEL } from '#/components/client/match/model';
import { Button } from '#/components/ui/button';
import { useDateTimeFormatter } from '#/lib/date-format';
import { formatRemaining } from '#/lib/relative-time';

import { addDays, startOfDay } from '../-model/clock';
import type { Timeline } from '../-model/launches';
import type { ProductSearch } from '../-model/options';
import { PaymentPanel } from './payment-panel';
import { usePageContext } from './page-context';

type Props = {
  search: ProductSearch;
  timeline: Timeline;
};

// 予選敗北後に選べる最初のローンチ日までの日数(FR-RELCH-002・003)
const RELAUNCH_DAYS = { off: 7, on: 2 } as const;

export function OwnerCard({ search, timeline }: Props) {
  const { now } = usePageContext();
  const reasonId = useId();
  const dateFormatter = useDateTimeFormatter('date');
  const yearDateFormatter = useDateTimeFormatter('yearDate');
  const weekdayFormatter = useDateTimeFormatter('dateWeekday');
  const { progress, ultras, flag, page } = search;
  const exempt = ultras === 'on';
  const showUltras = flag === 'on' && ultras === 'off';
  const liveRound = timeline.live?.round
    ? ROUND_LABEL[timeline.live.round]
    : '';

  const unlockText = (deadline: Date, kind: 'week' | 'year') => {
    const formatted = (
      kind === 'week' ? dateFormatter : yearDateFormatter
    ).format(deadline);
    return `参加しない場合は${formatted}(${formatRemaining(deadline, now)})に解除されます。`;
  };

  const earliestRelaunch = (() => {
    if (!timeline.currentLaunchDate) return null;
    const byInterval = addDays(
      timeline.currentLaunchDate,
      RELAUNCH_DAYS[ultras],
    );
    // 翌日以降しか選べない(FR-PRDCT-002)
    const tomorrow = addDays(startOfDay(now), 1);
    return byInterval > tomorrow ? byInterval : tomorrow;
  })();

  const status = ((): {
    headline: string;
    reason: string | null;
    note: string | null;
  } => {
    switch (progress) {
      case 'scheduled':
        return {
          headline: `${timeline.currentLaunchDate ? weekdayFormatter.format(timeline.currentLaunchDate) : ''}にキックオフ予定です`,
          reason:
            'このプロダクトはローンチ予定があるため再ローンチできません。',
          note: null,
        };
      case 'qualifier-live':
        return {
          headline: '予選マッチ中です',
          reason:
            'このプロダクトは予選マッチに参加中のため再ローンチできません。',
          note: 'マッチ中はローンチ日・カテゴリの変更と削除はできません。',
        };
      case 'cooldown':
        return {
          headline: '予選は敗北でした。改善して再挑戦しましょう',
          reason: null,
          note: earliestRelaunch
            ? `このプロダクトは${dateFormatter.format(earliestRelaunch)}以降のローンチ日を選べます。`
            : null,
        };
      case 'week-pending':
      case 'week-urgent':
        return {
          headline: '予選勝利！Weekトーナメントに参加できます',
          reason:
            exempt || !timeline.weekDeadline
              ? 'このプロダクトはWeekトーナメント参加中のため再ローンチできません。'
              : `このプロダクトはWeekトーナメントに参加できる期間中のため再ローンチできません。${unlockText(timeline.weekDeadline, 'week')}`,
          note: null,
        };
      case 'week-playing':
        return {
          headline: `Weekトーナメント${liveRound}を戦っています`,
          reason:
            'このプロダクトはWeekトーナメント参加中のため再ローンチできません。',
          note: 'マッチ中はローンチ日・カテゴリの変更と削除はできません。',
        };
      case 'year-pending':
        return {
          headline: 'Product of the Week受賞！Yearトーナメントに参加できます',
          reason:
            exempt || !timeline.yearDeadline
              ? 'このプロダクトはYearトーナメント参加中のため再ローンチできません。'
              : `このプロダクトはYearトーナメントに参加できる期間中のため再ローンチできません。${unlockText(timeline.yearDeadline, 'year')}`,
          note: null,
        };
      case 'year-playing':
        return {
          headline: `Yearトーナメント${liveRound}を戦っています`,
          reason:
            'このプロダクトはYearトーナメント参加中のため再ローンチできません。',
          note: 'マッチ中はローンチ日・カテゴリの変更と削除はできません。',
        };
      default:
        return {
          headline: '次のローンチを予約できます',
          reason: null,
          note: null,
        };
    }
  })();

  const paymentKind =
    progress === 'week-pending' || progress === 'week-urgent'
      ? 'week'
      : progress === 'year-pending'
        ? 'year'
        : null;
  const deadline =
    paymentKind === 'week' ? timeline.weekDeadline : timeline.yearDeadline;

  return (
    <section
      aria-labelledby="owner-heading"
      className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="owner-heading" className="text-sm font-extrabold">
          あなたのプロダクト
        </h2>
        <span className="rounded-full bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
          投稿者にのみ表示
        </span>
      </div>
      <p className="mt-2 text-base font-extrabold">{status.headline}</p>

      {paymentKind && deadline && (
        <div className="mt-3">
          <PaymentPanel
            kind={paymentKind}
            deadline={deadline}
            urgent={progress === 'week-urgent'}
            exempt={exempt}
            degraded={page === 'degraded'}
            showUltrasLink={showUltras}
          />
        </div>
      )}

      <div className="mt-4 flex gap-2 [&>*:last-child]:flex-1">
        <Button variant="outline" asChild className="bg-card">
          <a href="#">
            <PencilIcon aria-hidden="true" />
            編集
          </a>
        </Button>
        {status.reason ? (
          <Button disabled aria-describedby={reasonId}>
            <RocketIcon aria-hidden="true" />
            再ローンチを予約
          </Button>
        ) : (
          <Button asChild>
            <a href="#" aria-describedby={status.note ? reasonId : undefined}>
              <RocketIcon aria-hidden="true" />
              再ローンチを予約
            </a>
          </Button>
        )}
      </div>
      {(status.reason ?? status.note) && (
        <p
          id={reasonId}
          className="mt-2 flex gap-1.5 text-xs text-muted-foreground"
        >
          <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {status.reason ?? status.note}
        </p>
      )}
      {status.reason && status.note && (
        <p className="mt-1.5 flex gap-1.5 text-xs text-muted-foreground">
          <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {status.note}
        </p>
      )}
      {progress === 'cooldown' && showUltras && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span translate="no">Ultras</span>なら敗北後2日で再ローンチできます。
          <a href="#" className="ml-1 font-semibold text-primary">
            料金を見る
          </a>
        </p>
      )}
    </section>
  );
}
