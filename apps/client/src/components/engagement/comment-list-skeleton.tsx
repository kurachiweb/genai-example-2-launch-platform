import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import {
  COMMENTS_LOADING_LABEL,
  COMMENTS_LOADING_MORE_LABEL,
} from './comment-messages.ts';

export interface CommentListSkeletonProps {
  // 取得済みのコメントの後に続きを読み込んでいる間
  readonly loadingMore?: boolean;
}

const INITIAL_ROWS = [0, 1, 2] as const;

const MORE_ROWS = [0, 1] as const;

export function CommentListSkeleton({
  loadingMore = false,
}: CommentListSkeletonProps) {
  const rows = loadingMore ? MORE_ROWS : INITIAL_ROWS;
  return (
    <LoadingSkeleton
      label={loadingMore ? COMMENTS_LOADING_MORE_LABEL : COMMENTS_LOADING_LABEL}
    >
      <div className="flex flex-col gap-4">
        {rows.map((row) => (
          <div key={row} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </LoadingSkeleton>
  );
}
