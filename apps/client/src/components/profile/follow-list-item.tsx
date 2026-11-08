import { Link } from '@tanstack/react-router';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import type {
  FollowListDirection,
  FollowListEntry,
} from '../../graphql/follow-list.ts';
import { FOLLOW_LIST_FOLLOWED_AT_LABELS } from './follow-list-messages.ts';
import { UserAvatar } from './user-avatar.tsx';

export interface FollowListItemProps {
  readonly entry: FollowListEntry;
  readonly direction: FollowListDirection;
}

// 続きを読み込んだ後に、加えた最初の項目へフォーカスを移せるよう、プログラムからだけフォーカスできるようにする。リンクの名前にニックネームが重ねて入らないよう、プロフィール画像は支援技術から隠す
export function FollowListItem({ entry, direction }: FollowListItemProps) {
  return (
    <li tabIndex={-1} className="rounded-xl">
      <Link
        to="/@{$handle}"
        params={{ handle: entry.handle }}
        className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground no-underline hover:bg-accent hover:text-accent-foreground"
      >
        <span aria-hidden="true" className="shrink-0">
          <UserAvatar user={entry} size={32} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-bold">{entry.nickname}</span>
          <span className="truncate text-sm text-muted-foreground">
            @{entry.handle}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          <span className="sr-only">
            {FOLLOW_LIST_FOLLOWED_AT_LABELS[direction]}
          </span>{' '}
          <DateTime value={entry.followedAt} format="longDateTime" />
        </span>
      </Link>
    </li>
  );
}
