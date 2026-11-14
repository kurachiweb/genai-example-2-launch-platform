import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';

const CARD_KEYS = ['lead', 'second', 'third'];

// 上部の行・予選の見出し・対戦カード(画面幅1280px以上は2列で先頭が全幅)の形を保ち、読み込みの後の配置のずれを抑える
export function TopPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-4 pb-10">
      <LoadingSkeleton>
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <div className="pt-10">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-4 w-64" />
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {CARD_KEYS.map((key, index) => (
              <Skeleton
                key={key}
                className={
                  index === 0
                    ? 'h-72 rounded-2xl xl:col-span-2'
                    : 'h-72 rounded-2xl'
                }
              />
            ))}
          </div>
        </div>
      </LoadingSkeleton>
    </div>
  );
}
