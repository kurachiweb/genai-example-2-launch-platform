import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from '@tanstack/react-router';
import type { SearchSchemaInput } from '@tanstack/react-router';

import { SiteFooter } from '#/components/client/site-footer';
import { SiteHeader } from '#/components/client/site-header';
import { StatePanel } from '#/components/client/state-panel';
import { VerifyEmailBanner } from '#/components/client/verify-email-banner';
import { CURRENT_USER } from '#/lib/mock-data';

import { EmptyState } from './-components/empty-state';
import { FilterToolbar } from './-components/filter-toolbar';
import { LaunchCta } from './-components/launch-cta';
import { ListError } from './-components/list-error';
import { ListSkeleton } from './-components/list-skeleton';
import { ResultList } from './-components/result-list';
import { useDirectoryFormat } from './-components/use-directory-format';
import { categoryMaster, findCategory } from './-model/categories';
import { buildListing } from './-model/listing';
import {
  DEFAULT_STATE,
  OPTIONS,
  OPTION_LABELS,
  PANEL_SECTIONS,
  describeChanges,
  normalizeState,
} from './-model/options';
import type { OptionKey } from './-model/options';
import { PERIOD_LABELS, periodKeyOf, withConditions } from './-model/query';
import type { DirectoryQuery } from './-model/query';
import {
  queryOf,
  sameQuery,
  stateOf,
  validateDirectorySearch,
} from './-model/search';
import type { DirectorySearch } from './-model/search';

export const Route = createFileRoute('/client/p/')({
  // URLを直接開いた場合も、不正な値や矛盾する組み合わせは整合する状態へ直して表示する
  validateSearch: (raw: Partial<DirectorySearch> & SearchSchemaInput) =>
    validateDirectorySearch(raw),
  search: { middlewares: [stripSearchParams(DEFAULT_STATE)] },
  head: () => ({
    meta: [{ title: 'ディレクトリ | Launch Stadium 画面デザイン案' }],
  }),
  component: DirectoryPage,
});

// 実際の操作でも本番に近い体感を確認できるよう、条件変更のたびに再読み込みを挟む
const REFETCH_MS = 600;
const RETRY_LATENCY_MS = 900;
const HIGHLIGHT_MS = 2500;

function DirectoryPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const format = useDirectoryFormat();
  const state = stateOf(search);
  const query = queryOf(search);
  const master = useMemo(
    () => categoryMaster({ categories: search.categories, text: search.text }),
    [search.categories, search.text],
  );
  const listSectionRef = useRef<HTMLElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const [shownQuery, setShownQuery] = useState<DirectoryQuery>(query);
  const [refetching, setRefetching] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<OptionKey[]>([]);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    if (sameQuery(shownQuery, query)) return;
    setRefetching(true);
    const timer = window.setTimeout(() => {
      setShownQuery(query);
      setRefetching(false);
    }, REFETCH_MS);
    return () => window.clearTimeout(timer);
    // queryKeyが変わった時だけ再読み込みを始める
  }, [queryKey]);

  useEffect(() => {
    if (!retrying) return;
    const timer = window.setTimeout(() => setRetrying(false), RETRY_LATENCY_MS);
    return () => window.clearTimeout(timer);
  }, [retrying]);

  useEffect(() => {
    if (highlighted.length === 0) return;
    const timer = window.setTimeout(() => setHighlighted([]), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

  const viewer = state.auth === 'guest' ? null : CURRENT_USER;
  const listing = buildListing(state, shownQuery, master);

  const updateQuery = (next: DirectoryQuery) =>
    navigate({
      search: (prev: DirectorySearch) => ({ ...prev, ...next }),
      resetScroll: false,
    });
  const patchConditions = (patch: Partial<Omit<DirectoryQuery, 'page'>>) =>
    updateQuery(withConditions(query, patch));

  const changeState = (key: OptionKey, value: string) => {
    const resolved = normalizeState({ ...state, [key]: value }, key);
    setNotice(
      resolved.changed.length > 0
        ? describeChanges(resolved.state, resolved.changed, key)
        : null,
    );
    setHighlighted(resolved.changed);
    navigate({
      search: (prev: DirectorySearch) => ({ ...prev, ...resolved.state }),
      replace: true,
      resetScroll: false,
    });
  };

  const focusList = () => {
    const reduced = document.documentElement.dataset.motion === 'off';
    listSectionRef.current?.scrollIntoView({
      block: 'start',
      behavior: reduced ? 'auto' : 'smooth',
    });
    listHeadingRef.current?.focus({ preventScroll: true });
  };

  const periodKey = periodKeyOf({ from: shownQuery.from, to: shownQuery.to });
  const loading = state.load === 'loading' || retrying;

  const body = (() => {
    if (loading) return <ListSkeleton />;
    if (state.load === 'error') {
      return <ListError onRetry={() => setRetrying(true)} />;
    }
    switch (listing.kind) {
      case 'empty':
        return listing.reason === 'filtered' ? (
          <EmptyState
            kind="filtered"
            query={shownQuery}
            categoryName={findCategory(master, shownQuery.category)?.name}
            periodLabel={
              periodKey === 'all'
                ? undefined
                : periodKey === 'custom'
                  ? format.rangeLabel(shownQuery)
                  : PERIOD_LABELS[periodKey]
            }
          />
        ) : (
          <EmptyState kind="none" loggedIn={viewer !== null} />
        );
      case 'out-of-range':
        return (
          <EmptyState
            kind="out-of-range"
            page={listing.page}
            pageCount={listing.pageCount}
          />
        );
      case 'results':
        return (
          <>
            <ResultList
              {...listing}
              query={shownQuery.q}
              imagesBroken={state.images === 'broken'}
              refetching={refetching || state.load === 'refetch'}
              onNavigate={focusList}
            />
            <LaunchCta loggedIn={viewer !== null} />
          </>
        );
    }
  })();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader user={viewer} logoAs="div" />
      {state.auth === 'unverified' && <VerifyEmailBanner />}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 sm:pt-8">
        <div className="mb-5">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            ディレクトリ
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            予選マッチに勝利したプロダクトだけが並ぶカタログです。
          </p>
        </div>

        <FilterToolbar
          query={query}
          categories={master}
          categoriesLoading={state.load === 'loading'}
          onSearch={(q) => patchConditions({ q })}
          onCategory={(category) => patchConditions({ category })}
          onPeriod={(range) =>
            patchConditions({ from: range.from, to: range.to })
          }
          onSort={(sort) => patchConditions({ sort })}
          onSheetApply={(patch) => patchConditions(patch)}
        />

        <section
          ref={listSectionRef}
          aria-labelledby="results-heading"
          className="mt-6 scroll-mt-20"
        >
          <h2
            id="results-heading"
            ref={listHeadingRef}
            tabIndex={-1}
            className="sr-only"
          >
            プロダクト一覧
          </h2>
          {body}
        </section>
      </main>
      <SiteFooter />

      <StatePanel
        sections={PANEL_SECTIONS}
        options={OPTIONS}
        labels={OPTION_LABELS}
        values={state}
        onChange={changeState}
        notice={notice}
        highlighted={highlighted}
      />
    </div>
  );
}
