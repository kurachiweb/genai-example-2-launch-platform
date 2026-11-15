import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import { HelpArticleToolbar } from './help-article-toolbar.tsx';
import { HELP_ARTICLE_LOADING_LABEL } from './help-messages.ts';

const BODY_LINES = [
  { key: 'first', width: '100%' },
  { key: 'second', width: '96%' },
  { key: 'third', width: '88%' },
  { key: 'fourth', width: '64%' },
];

const BODY_SECTIONS = ['first', 'second'];

const TOC_LINES = [
  { key: 'first', width: '80%' },
  { key: 'second', width: '64%' },
  { key: 'third', width: '72%' },
];

// 記事詳細と同じ位置に見出し・作成者と更新日時・本文・目次の形を置き、読み込みの後の配置のずれを抑える
export function HelpArticleSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-6 pb-12 sm:pt-8">
      <HelpArticleToolbar />
      <LoadingSkeleton label={HELP_ARTICLE_LOADING_LABEL}>
        <div className="flex flex-col gap-8">
          <div
            data-skeleton-part="header"
            className="flex flex-col gap-3 border-b border-border pb-6"
          >
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <div className="mt-2 flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10">
            <div
              data-skeleton-part="toc"
              className="lg:col-start-2 lg:row-start-1"
            >
              <Skeleton className="h-12 rounded-xl lg:hidden" />
              <div className="hidden flex-col gap-2.5 lg:flex">
                <Skeleton className="h-3 w-12" />
                {TOC_LINES.map(({ key, width }) => (
                  <Skeleton key={key} className="h-4" style={{ width }} />
                ))}
              </div>
            </div>
            <div
              data-skeleton-part="body"
              className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1"
            >
              {BODY_SECTIONS.map((section) => (
                <div key={section} className="flex flex-col gap-3">
                  <Skeleton className="h-7 w-48" />
                  {BODY_LINES.map(({ key, width }) => (
                    <Skeleton key={key} className="h-4" style={{ width }} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </LoadingSkeleton>
    </div>
  );
}
