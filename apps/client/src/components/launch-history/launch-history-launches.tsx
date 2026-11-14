import { useLayoutEffect, useRef, useState } from 'react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import type { ProductLaunchView } from '../../graphql/product-launch.ts';
import { HOME_HREF } from '../layout/site-links.ts';
import { KickoffTime } from '../product/kickoff-time.tsx';
import { LaunchDateText } from '../product/launch-date-text.tsx';
import { WATCH_ON_TOP_LABEL } from '../product/launch-messages.ts';
import {
  launchNumberLabel,
  showMoreLaunchesLabel,
} from './launch-history-messages.ts';

export interface LaunchHistoryLaunchesProps {
  // 取消を除く、新しい順
  readonly launches: readonly ProductLaunchView[];
  // 停止中の本人にはリンクを出さない
  readonly linked: boolean;
}

const INITIAL_VISIBLE = 3;

const isUpcoming = ({ status }: ProductLaunchView): boolean =>
  status === 'scheduled' || status === 'paired';

function LaunchRow({
  launch,
  linked,
}: {
  readonly launch: ProductLaunchView;
  readonly linked: boolean;
}) {
  return (
    <>
      <span className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-semibold tabular-nums">
          {launchNumberLabel(launch.number)}
        </span>
        <LaunchDateText date={launch.launchDate} />
        <span className="font-semibold">{launch.summary.label}</span>
      </span>
      {isUpcoming(launch) && (
        <span className="block text-muted-foreground">
          <KickoffTime kickoffAt={launch.kickoffAt} />
        </span>
      )}
      {launch.summary.inMatch && linked && (
        <span className="block">
          <PathLink
            href={HOME_HREF}
            className={`relative z-10 ${INLINE_LINK_CLASS_NAME}`}
          >
            {WATCH_ON_TOP_LABEL}
          </PathLink>
        </span>
      )}
    </>
  );
}

// ローンチを新しい順に3件まで示し、残りは「他◯回を表示」で開く。ボタンは開くと消えるため、開いた最初のローンチへフォーカスを移す
export function LaunchHistoryLaunches({
  launches,
  linked,
}: LaunchHistoryLaunchesProps) {
  const [expanded, setExpanded] = useState(false);
  const firstHiddenRef = useRef<HTMLLIElement>(null);
  const focusPendingRef = useRef(false);

  useLayoutEffect(() => {
    if (expanded && focusPendingRef.current) {
      focusPendingRef.current = false;
      firstHiddenRef.current?.focus();
    }
  }, [expanded]);

  if (launches.length === 0) {
    return null;
  }
  const visible = expanded ? launches : launches.slice(0, INITIAL_VISIBLE);
  const hiddenCount = launches.length - visible.length;

  return (
    <div className="flex flex-col items-start gap-2">
      <ol className="flex w-full flex-col gap-1.5 text-sm">
        {visible.map((launch, index) => (
          <li
            key={launch.id}
            ref={index === INITIAL_VISIBLE ? firstHiddenRef : undefined}
            tabIndex={index === INITIAL_VISIBLE ? -1 : undefined}
            className="rounded-md"
          >
            <LaunchRow launch={launch} linked={linked} />
          </li>
        ))}
      </ol>
      {hiddenCount > 0 && (
        <button
          type="button"
          className={`relative z-10 text-sm ${INLINE_LINK_CLASS_NAME}`}
          onClick={() => {
            focusPendingRef.current = true;
            setExpanded(true);
          }}
        >
          {showMoreLaunchesLabel(hiddenCount)}
        </button>
      )}
    </div>
  );
}
