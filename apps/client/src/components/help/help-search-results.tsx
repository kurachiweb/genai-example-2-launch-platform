import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';

import { normalizeSearchTerms } from '../../../common-lib/search/search-terms.ts';
import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { formatNumber } from '../../../lib/utilities/number/number-format.ts';
import type { ClientHelpArticleSearchQuery } from '../../graphql/generated/graphql.ts';
import { HelpArticleLinkItem } from './help-article-link-item.tsx';
import {
  HELP_ALL_ARTICLES_LABEL,
  HELP_SEARCH_COUNT_LOADING,
  helpSearchNoResults,
  helpSearchResultCount,
  helpSearchResultsHeading,
} from './help-messages.ts';

export interface HelpSearchResultsProps {
  // 結果を取得した検索語(再読み込みの間は直前の検索語)
  readonly query: string;
  // APIが関連度の高い順に返した公開の記事
  readonly hits: ClientHelpArticleSearchQuery['helpArticleSearch'];
  // 検索語を変えた後、新しい結果が届くまでの間
  readonly refetching: boolean;
}

// 再読み込みの間は直前の結果を薄く残して操作とフォーカスを止める(inert)
function RefetchFrame({
  refetching,
  children,
}: {
  readonly refetching: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div aria-busy={refetching || undefined}>
      <div
        inert={refetching}
        className={cn(refetching && 'opacity-45 saturate-50')}
      >
        {children}
      </div>
    </div>
  );
}

// 強調表示用の検索語はAPIが返さないため、URLの検索語から語を組み立てる
export function HelpSearchResults({
  query,
  hits,
  refetching,
}: HelpSearchResultsProps) {
  const headingId = useId();
  const preferences = useDisplayPreferences();
  if (hits.length === 0) {
    return (
      <RefetchFrame refetching={refetching}>
        <EmptyState
          title={helpSearchNoResults(query)}
          action={
            <Button variant="outline" asChild>
              <Link
                to="/help"
                search={{ q: undefined }}
                activeOptions={{ exact: true }}
              >
                {HELP_ALL_ARTICLES_LABEL}
              </Link>
            </Button>
          }
        />
      </RefetchFrame>
    );
  }
  const terms = normalizeSearchTerms(query);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id={headingId}
          className="text-lg font-extrabold tracking-tight wrap-anywhere"
        >
          {helpSearchResultsHeading(query)}
        </h2>
        {/* 検索語の変更で件数が変わったことを、一覧の操作を妨げずに支援技術へ伝える */}
        <p
          aria-live="polite"
          aria-atomic="true"
          className="text-sm font-semibold text-muted-foreground tabular-nums"
        >
          {refetching
            ? HELP_SEARCH_COUNT_LOADING
            : helpSearchResultCount(formatNumber(hits.length, preferences))}
        </p>
      </div>
      <RefetchFrame refetching={refetching}>
        <ul className="flex flex-col gap-2">
          {hits.map(({ handle, title, subtitle, categoryName }) => (
            <HelpArticleLinkItem
              key={handle}
              article={{ handle, title, subtitle }}
              terms={terms}
              categoryName={categoryName}
            />
          ))}
        </ul>
      </RefetchFrame>
    </section>
  );
}
