import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import { PRODUCT_PAGE_LOADING_LABEL } from './product-page-messages.ts';

const SCREENSHOT_RATIOS = [
  { key: 'wide', ratio: '16 / 10' },
  { key: 'portrait', ratio: '9 / 10' },
  { key: 'square', ratio: '10 / 10' },
  { key: 'last', ratio: '16 / 10' },
];

const DESCRIPTION_LINES = [
  { key: 'first', width: '100%' },
  { key: 'second', width: '96%' },
  { key: 'third', width: '88%' },
  { key: 'fourth', width: '60%' },
];

const HISTORY_ROWS = ['latest', 'previous', 'oldest'];

// パンくずリスト・ヘッダー・本文・サイドバーの形を保ち、読み込みの後の配置のずれを抑える
export function ProductPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-5 pb-10">
      <LoadingSkeleton label={PRODUCT_PAGE_LOADING_LABEL}>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-4 w-64" />
          <div className="grid gap-x-6 gap-y-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex min-w-0 flex-col gap-8">
              <div className="rounded-2xl border border-border bg-card p-5 sm:p-7">
                <div className="flex items-start gap-4 sm:gap-6">
                  <Skeleton className="size-20 shrink-0 rounded-2xl sm:size-32" />
                  <div className="flex flex-1 flex-col gap-3 pt-1">
                    <Skeleton className="h-5 w-24 rounded-full" />
                    <Skeleton className="h-9 w-3/4" />
                    <Skeleton className="h-5 w-full" />
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-10 rounded-full" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                  <Skeleton className="h-10 w-36" />
                </div>
              </div>
              <div className="flex gap-3 overflow-hidden">
                {SCREENSHOT_RATIOS.map(({ key, ratio }) => (
                  <Skeleton
                    key={key}
                    className="h-52 shrink-0 rounded-xl sm:h-72"
                    style={{ aspectRatio: ratio }}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-3">
                <Skeleton className="h-6 w-32" />
                {DESCRIPTION_LINES.map(({ key, width }) => (
                  <Skeleton key={key} className="h-4" style={{ width }} />
                ))}
              </div>
              <div className="flex flex-col gap-3">
                <Skeleton className="h-6 w-48" />
                {HISTORY_ROWS.map((key) => (
                  <Skeleton key={key} className="h-20 w-full rounded-xl" />
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 lg:col-start-2 lg:row-start-1 lg:self-start">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-3 h-12 w-24" />
              <Skeleton className="mt-4 h-7 w-40" />
            </div>
          </div>
        </div>
      </LoadingSkeleton>
    </div>
  );
}
