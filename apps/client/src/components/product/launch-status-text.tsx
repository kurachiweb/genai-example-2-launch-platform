import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import type { ProductLaunchView } from '../../graphql/product-launch.ts';
import { HOME_HREF } from '../layout/site-links.ts';
import { KickoffTime } from './kickoff-time.tsx';
import { LaunchDateText } from './launch-date-text.tsx';
import {
  LAUNCH_DATE_PREFIX,
  LAUNCH_STATUS_LABELS,
  WATCH_ON_TOP_LABEL,
} from './launch-messages.ts';

export interface LaunchStatusTextProps {
  readonly launch: ProductLaunchView;
}

const finishedLabelOf = ({ outcome, summary }: ProductLaunchView): string => {
  if (outcome === null) {
    return summary.label;
  }
  return LAUNCH_STATUS_LABELS[outcome];
};

function StatusDetail({ launch }: LaunchStatusTextProps) {
  switch (launch.status) {
    case 'scheduled':
    case 'paired':
      return (
        <p>
          <KickoffTime kickoffAt={launch.kickoffAt} />
        </p>
      );
    case 'in_progress':
      return (
        <p>
          <PathLink href={HOME_HREF} className={INLINE_LINK_CLASS_NAME}>
            {WATCH_ON_TOP_LABEL}
          </PathLink>
        </p>
      );
    case 'finished':
      return (
        <p>
          {LAUNCH_DATE_PREFIX}
          <LaunchDateText date={launch.launchDate} />
        </p>
      );
    case 'canceled':
      return null;
  }
}

const statusLabelOf = (launch: ProductLaunchView): string => {
  switch (launch.status) {
    case 'scheduled':
    case 'paired':
      return LAUNCH_STATUS_LABELS.scheduled;
    case 'in_progress':
      return LAUNCH_STATUS_LABELS.in_progress;
    case 'finished':
      return finishedLabelOf(launch);
    case 'canceled':
      return LAUNCH_STATUS_LABELS.canceled;
  }
};

export function LaunchStatusText({ launch }: LaunchStatusTextProps) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-semibold">{statusLabelOf(launch)}</p>
      <StatusDetail launch={launch} />
    </div>
  );
}
