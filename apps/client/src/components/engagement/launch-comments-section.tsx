import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon, MessageCircleIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { formatNumber } from '../../../lib/utilities/number/number-format.ts';
import { LAUNCH_NOT_COMMENTABLE_MESSAGE } from '../../../common-lib/engagement/engagement-rules.ts';
import { launchCommentCountsQueryOptions } from '../../graphql/engagement.ts';
import type { ClientLaunchCommentCountsQuery } from '../../graphql/generated/graphql.ts';
import type { ProductLaunchSectionContext } from '../product-page/product-page-section-types.ts';
import { CommentThread } from './comment-thread.tsx';
import {
  COMMENTS_TOGGLE_LABEL,
  commentCountLabel,
  launchCommentsLabel,
} from './comment-messages.ts';
import { useEngagementViewer } from './use-engagement-viewer.ts';

// 閲覧できないプロダクト(null)と応答に無いローンチは件数を示さない
const countOf =
  (launchId: string) =>
  ({ launchCommentCounts }: ClientLaunchCommentCountsQuery): number | null =>
    launchCommentCounts?.find((entry) => entry.launchId === launchId)?.count ??
    null;

// ローンチのブロックのコメント欄。開いている間だけスレッドを取得して描き、件数は同じプロダクトのブロックで1つの取得を共有する
export function LaunchCommentsSection({
  product,
  viewer,
  launch,
}: ProductLaunchSectionContext) {
  const preferences = useDisplayPreferences();
  const panelId = useId();
  const [open, setOpen] = useState(launch.latestKickedOff);
  const { viewerId } = useEngagementViewer({ viewer });
  const { data: count } = useQuery({
    ...launchCommentCountsQueryOptions(viewerId, product.id),
    select: countOf(launch.id),
    enabled: launch.kickedOff,
  });

  if (!launch.kickedOff) {
    return (
      <p className="text-sm text-muted-foreground">
        {LAUNCH_NOT_COMMENTABLE_MESSAGE}
      </p>
    );
  }

  return (
    <section aria-label={launchCommentsLabel(launch.number)}>
      <Button
        type="button"
        variant="ghost"
        className="-ml-3 text-base font-extrabold"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <MessageCircleIcon aria-hidden="true" className="text-primary" />
        {COMMENTS_TOGGLE_LABEL}
        {count !== null && count !== undefined && (
          <span className="text-sm font-semibold text-muted-foreground tabular-nums">
            {commentCountLabel(formatNumber(count, preferences))}
          </span>
        )}
        <ChevronDownIcon
          aria-hidden="true"
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </Button>
      <div id={panelId} hidden={!open} className="mt-3">
        {open && (
          <CommentThread
            product={{ id: product.id, handle: product.handle }}
            launch={{ id: launch.id }}
            viewerIsOwner={viewer.isOwner}
          />
        )}
      </div>
    </section>
  );
}
