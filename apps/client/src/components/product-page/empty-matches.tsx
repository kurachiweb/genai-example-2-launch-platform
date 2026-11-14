import { CalendarClockIcon, RadioIcon } from 'lucide-react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { HOME_HREF, productDetailHref } from '../layout/site-links.ts';
import { LaunchDateText } from '../product/launch-date-text.tsx';
import { CopyLinkButton } from './copy-link-button.tsx';
import {
  emptyMatchesStateOf,
  type ProductPageLaunchView,
} from './match-history-model.ts';
import {
  GUEST_KICKOFF_NOTE,
  KICKOFF_SUFFIX,
  LIVE_MATCH_HEADING_ID,
  LIVE_QUALIFIER_NOTICE,
  OWNER_KICKOFF_NOTE,
  SHARE_LINK_LABEL,
  WATCH_LIVE_MATCH_LABEL,
  WATCH_TODAY_ON_TOP_LABEL,
} from './match-history-messages.ts';

export interface EmptyMatchesProps {
  readonly launch: ProductPageLaunchView;
  readonly isOwner: boolean;
  // 現在のハンドル。リンクのコピーで正規のURLを作る
  readonly productHandle: string;
}

// 結果の確定したマッチが無いローンチのブロックに、開催中なら開催中のマッチの区画への導線を、キックオフ前なら当日の案内を示す
export function EmptyMatches({
  launch,
  isOwner,
  productHandle,
}: EmptyMatchesProps) {
  const state = emptyMatchesStateOf(launch);
  if (state === 'none') {
    return null;
  }
  if (state === 'live') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-4 text-sm">
        <RadioIcon
          className="size-5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1">{LIVE_QUALIFIER_NOTICE}</p>
        <Button size="sm" variant="outline" asChild>
          <a href={`#${LIVE_MATCH_HEADING_ID}`}>{WATCH_LIVE_MATCH_LABEL}</a>
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
      <CalendarClockIcon
        className="mx-auto size-8 text-muted-foreground"
        aria-hidden="true"
      />
      {/* キックオフは業務日付の始まりのため、キックオフの日付はローンチ日の暦日と同じになる */}
      <p className="mt-2 font-semibold">
        <LaunchDateText date={launch.launchDate} />
        {KICKOFF_SUFFIX}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isOwner ? OWNER_KICKOFF_NOTE : GUEST_KICKOFF_NOTE}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {isOwner ? (
          <CopyLinkButton
            path={productDetailHref(productHandle)}
            label={SHARE_LINK_LABEL}
          />
        ) : (
          <Button size="sm" variant="outline" asChild>
            <PathLink href={HOME_HREF}>{WATCH_TODAY_ON_TOP_LABEL}</PathLink>
          </Button>
        )}
      </div>
    </div>
  );
}
