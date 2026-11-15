import { useSuspenseInfiniteQuery } from '@tanstack/react-query';

import { upvoteHistoryQueryOptions } from '../../graphql/upvote-history.ts';
import { useViewer } from '../auth/use-viewer.ts';
import type { PublicProfileSectionContext } from '../profile/public-profile-section-types.ts';

const COUNT_FORMAT = new Intl.NumberFormat('ja-JP');

// パネルと同じ取得を共有し、取得中と失敗はタブの件数の枠に任せる。利用者を表示できない(null)時は0件として示す
export function UpvoteHistoryCount({ handle }: PublicProfileSectionContext) {
  const viewer = useViewer();
  const { data: totalCount } = useSuspenseInfiniteQuery({
    ...upvoteHistoryQueryOptions(viewer, handle),
    select: ({ pages }) => pages[0]?.upvoteHistory?.totalCount ?? 0,
  });
  return <>{COUNT_FORMAT.format(totalCount)}</>;
}
