import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';

import { LaunchHighlightChip } from '#/components/client/launch-highlight-chip';
import { isoDate } from '#/lib/clock';
import { useDateTimeFormatter } from '#/lib/date-format';
import { formatRemaining } from '#/lib/relative-time';

import type { LaunchEntry } from '../-model/products';

type Props = {
  launch: LaunchEntry;
  now: Date;
  // 停止中は導線を出さない
  interactive: boolean;
};

// 「第3回・ローンチ日・結果の要約」。キックオフ予定はユーザーのタイムゾーンでの日時と相対表現を併記する
export function LaunchRow({ launch, now, interactive }: Props) {
  const dateFormatter = useDateTimeFormatter('longDate');
  const kickoffFormatter = useDateTimeFormatter('dateTime');
  const scheduled = launch.outcome === 'scheduled';

  return (
    <li className="flex items-baseline gap-3 text-sm">
      <span className="w-12 shrink-0 font-bold sm:w-14">
        第{launch.number}回
      </span>
      {/* 折り返した結果やリンクも回数の列に回り込ませず、日付の位置から揃える */}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        {scheduled ? (
          <time
            dateTime={launch.date.toISOString()}
            className="text-muted-foreground"
          >
            {kickoffFormatter.format(launch.date)}
          </time>
        ) : (
          <time
            dateTime={isoDate(launch.date)}
            className="text-muted-foreground"
          >
            {dateFormatter.format(launch.date)}
          </time>
        )}
        <span className="flex flex-wrap items-center gap-1.5">
          {launch.highlights.map((highlight) => (
            <LaunchHighlightChip key={highlight.label} {...highlight} />
          ))}
        </span>
        {scheduled && (
          <span className="text-xs font-semibold text-primary">
            {formatRemaining(launch.date, now)}
          </span>
        )}
        {launch.live && interactive && (
          <Link
            to="/client/top"
            className="relative z-10 inline-flex items-center gap-0.5 rounded-sm text-xs font-bold text-primary no-underline hover:underline"
          >
            トップページで見る
            <ArrowRightIcon className="size-3.5" aria-hidden="true" />
          </Link>
        )}
      </span>
    </li>
  );
}
