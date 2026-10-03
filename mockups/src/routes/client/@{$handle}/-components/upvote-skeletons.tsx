import { Skeleton } from '#/components/ui/skeleton';

type Props = { count: number };

// ロゴ・名称・投稿者・マッチ種別の形を保ったスケルトン
export function UpvoteSkeletons({ count }: Props) {
  return (
    <ul className="space-y-2">
      {Array.from({ length: count }, (_, index) => (
        <li
          key={index}
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 sm:px-4"
        >
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
