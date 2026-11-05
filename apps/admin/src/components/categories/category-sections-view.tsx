import { QueryErrorResetBoundary } from '@tanstack/react-query';
import {
  CatchBoundary,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { type ReactNode, Suspense, useId } from 'react';

import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import type { CategorySection } from '../../composition/category-sections.ts';

export interface CategorySectionsViewProps {
  readonly sections: readonly CategorySection[];
}

// 境界が捕まえた失敗はルーターのdefaultOnCatchへ届かないため、ここで送る。GraphQLの想定外の失敗はexecuteGraphQLが送っているため送り直さない
const reportSectionFailure = (error: unknown): void => {
  if (!(error instanceof GraphQLClientError)) {
    reportUnexpectedErrorInBrowser(error, 'render');
  }
};

// 区画の部品はCategoryMasterEditorで自分の見出しを描くため、見出しは部品が描けない読み込み中と失敗の間だけここで描く
function SectionFallback({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

// 1つの区画の描画や取得の失敗をその区画の位置に留め、他の区画の表示を続ける。再試行は取得の失敗の記録とエラーの境界の両方を解除して描き直す
function SectionBoundary({
  section: { title, component: Section },
}: {
  readonly section: CategorySection;
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset: resetQueries }) => (
        <CatchBoundary
          getResetKey={() => 0}
          onCatch={reportSectionFailure}
          errorComponent={({ error, reset }: ErrorComponentProps) => (
            <SectionFallback title={title}>
              <ErrorState
                message={errorMessageOf(error, ADMIN_PROFILE.contactAvailable)}
                onRetry={() => {
                  resetQueries();
                  reset();
                }}
              />
            </SectionFallback>
          )}
        >
          <Suspense
            fallback={
              <SectionFallback title={title}>
                <LoadingSkeleton />
              </SectionFallback>
            }
          >
            <Section />
          </Suspense>
        </CatchBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

// 各specが登録したカテゴリマスタの区画を順序どおりに並べる
export function CategorySectionsView({ sections }: CategorySectionsViewProps) {
  return (
    <div className="flex flex-col gap-10">
      {sections
        .toSorted((a, b) => a.order - b.order)
        .map((section) => (
          <SectionBoundary key={section.id} section={section} />
        ))}
    </div>
  );
}
