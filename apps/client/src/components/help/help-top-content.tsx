import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  helpArticleSearchQueryOptions,
  helpCenterQueryOptions,
} from '../../graphql/help-center.ts';
import { HelpCategoryList } from './help-category-list.tsx';
import { HelpLoadError } from './help-load-error.tsx';
import { HELP_TOP_ERROR_MESSAGE } from './help-messages.ts';
import { HelpSearchResults } from './help-search-results.tsx';
import { HelpTopSkeleton } from './help-top-skeleton.tsx';

export interface HelpTopContentProps {
  // URLから正規化した適用中の検索語
  readonly query: string | undefined;
}

function HelpCenterContent() {
  const helpCenter = useQuery(helpCenterQueryOptions());
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の失敗はブラウザへ渡った後に取得し直した結果で表示を選び直すためでもある
  const error = helpCenter.isFetching ? null : helpCenter.error;
  if (error !== null) {
    return (
      <HelpLoadError
        message={HELP_TOP_ERROR_MESSAGE}
        onRetry={() => helpCenter.refetch()}
      />
    );
  }
  if (helpCenter.data === undefined) {
    return <HelpTopSkeleton />;
  }
  return <HelpCategoryList categories={helpCenter.data.helpCenter} />;
}

function HelpSearchContent({ query }: { readonly query: string }) {
  const search = useQuery({
    ...helpArticleSearchQueryOptions(query),
    placeholderData: keepPreviousData,
  });
  // 再読み込みの間に残す直前の結果は、見出しと強調を直前の検索語で示す。結果が届いた時点で描画中に差し替える
  const [shownQuery, setShownQuery] = useState(query);
  if (
    search.data !== undefined &&
    !search.isPlaceholderData &&
    shownQuery !== query
  ) {
    setShownQuery(query);
  }
  const error = search.isFetching ? null : search.error;
  if (error !== null) {
    return (
      <HelpLoadError
        message={HELP_TOP_ERROR_MESSAGE}
        onRetry={() => search.refetch()}
      />
    );
  }
  if (search.data === undefined) {
    return <HelpTopSkeleton />;
  }
  return (
    <HelpSearchResults
      query={search.isPlaceholderData ? shownQuery : query}
      hits={search.data.helpArticleSearch}
      refetching={search.isPlaceholderData}
    />
  );
}

// 検索語の変更の後も検索欄を作り直さないよう、取得の状態を一覧の位置だけで示す。
// 検索結果の間の検索語の変更では直前の結果を残し、一覧と検索結果の切り替えでは直前の値が無いためスケルトンにする
export function HelpTopContent({ query }: HelpTopContentProps) {
  return query === undefined ? (
    <HelpCenterContent />
  ) : (
    <HelpSearchContent query={query} />
  );
}
