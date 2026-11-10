import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type ReactNode, useId, useMemo, useState } from 'react';

import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  directoryCategoriesQueryOptions,
  directoryQueryOptions,
} from '../../graphql/directory.ts';
import type { ClientDirectoryQuery } from '../../graphql/generated/graphql.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { businessDateOf } from '../product/business-time.ts';
import { DirectoryEmptyState } from './directory-empty-state.tsx';
import { DirectoryList } from './directory-list.tsx';
import {
  DIRECTORY_LIST_ERROR_MESSAGE,
  DIRECTORY_LIST_HEADING,
} from './directory-list-messages.ts';
import { DirectoryListSkeleton } from './directory-list-skeleton.tsx';
import {
  DIRECTORY_PAGE_DESCRIPTION,
  DIRECTORY_PAGE_TITLE,
} from './directory-page-messages.ts';
import { DirectoryPagination } from './directory-pagination.tsx';
import { groupDirectorySections } from './directory-section-order.ts';
import type {
  DirectoryItemMetric,
  DirectoryListInsert,
  DirectorySection,
  DirectorySectionContext,
} from './directory-section-types.ts';
import { FilterToolbar } from './filter-toolbar.tsx';
import { LaunchCta } from './launch-cta.tsx';
import { ResultCount } from './result-count.tsx';
import { SearchForm } from './search-form.tsx';
import { useDirectoryNavigation } from './use-directory-navigation.ts';

export interface DirectoryPageProps {
  // URLから正規化した現在の条件
  readonly query: DirectoryQuery;
  readonly viewer: ClientViewer | null;
  // 区画の登録口(DIRECTORY_PAGE_SECTIONS)。置き場所ごとにorderの順で並べる
  readonly sections: readonly DirectorySection[];
  // 一覧の差し込みの登録口(DIRECTORY_LIST_INSERTS)
  readonly inserts: readonly DirectoryListInsert[];
  // 一覧の項目の値の登録口(DIRECTORY_ITEM_METRICS)
  readonly metrics: readonly DirectoryItemMetric[];
}

type DirectoryData = ClientDirectoryQuery['directory'];

// 区画が描けた間(目印の要素がある間)は境界の枠をdisplay:contentsにし、区画の要素そのものをページの列の項目にする。
// 該当せずnullを描いた区画が列の間隔を残さないようにする。
// display:contentsの要素はフォーカスできないため、再試行の後に枠へフォーカスを移す読み込み中と失敗の間は通常の箱のまま残す
const SECTION_SLOT_CLASS = 'has-[>[data-directory-section-rendered]]:contents';

function SectionSlots({
  sections,
  context,
}: {
  readonly sections: readonly DirectorySection[];
  readonly context: DirectorySectionContext;
}) {
  return sections.map(({ id, component: Section }) => (
    <RecoverableSlot
      key={id}
      className={SECTION_SLOT_CLASS}
      contactAvailable={CLIENT_PROFILE.contactAvailable}
      contactHref={CONTACT_HREF}
    >
      <Section viewer={context.viewer} query={context.query} />
      <span hidden data-directory-section-rendered="" />
    </RecoverableSlot>
  ));
}

// 条件の変更の後の読み込み中は、直前の結果を薄く残して操作を止め(inert)、上端に進捗のバーを出す。演出は持たず、動くのは進捗のバーだけ
function RefetchFrame({
  refetching,
  children,
}: {
  readonly refetching: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="relative" aria-busy={refetching || undefined}>
      {refetching ? (
        <div
          data-directory-progress=""
          aria-hidden="true"
          className="absolute inset-x-0 -top-2 h-1 overflow-hidden rounded-full bg-primary/15"
        >
          <div
            data-directory-progress-indicator=""
            className="h-full w-2/5 rounded-full bg-primary"
          />
        </div>
      ) : null}
      <div
        inert={refetching}
        className={cn(
          'flex flex-col gap-8',
          refetching && 'opacity-45 saturate-50',
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface ListBodyProps {
  readonly data: DirectoryData;
  readonly refetching: boolean;
  readonly query: DirectoryQuery;
  readonly signedIn: boolean;
  readonly categoryName: string | undefined;
  readonly inserts: readonly DirectoryListInsert[];
  readonly metrics: readonly DirectoryItemMetric[];
  readonly onPageNavigate: () => void;
}

function ListBody({
  data,
  refetching,
  query,
  signedIn,
  categoryName,
  inserts,
  metrics,
  onPageNavigate,
}: ListBodyProps) {
  if (data.items.length === 0) {
    return (
      <RefetchFrame refetching={refetching}>
        {data.totalCount > 0 ? (
          <DirectoryEmptyState
            kind="outOfRange"
            query={query}
            pageCount={data.pageCount}
          />
        ) : (
          <DirectoryEmptyState
            kind="noResults"
            query={query}
            categoryName={categoryName}
            businessToday={data.businessToday}
            signedIn={signedIn}
          />
        )}
      </RefetchFrame>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ResultCount
        totalCount={data.totalCount}
        page={data.page}
        pageCount={data.pageCount}
        loading={refetching}
      />
      <RefetchFrame refetching={refetching}>
        <DirectoryList
          items={data.items}
          query={query}
          searchTerms={data.searchTerms}
          metrics={metrics}
          inserts={inserts}
        />
        <DirectoryPagination
          query={query}
          pageCount={data.pageCount}
          onNavigate={onPageNavigate}
        />
      </RefetchFrame>
    </div>
  );
}

// 見出し・検索欄・絞り込み欄・件数・一覧とページ送り・ローンチの予約への導線を置き、登録された区画を置き場所ごとにエラーの境界で包んで並べる。
// 一覧は条件ごとに取得し、条件の変更の読み込み中は直前の一覧を残す。取得の失敗は一覧の位置だけに示し、検索欄と絞り込み欄は操作できるまま残す
export function DirectoryPage({
  query,
  viewer,
  sections,
  inserts,
  metrics,
}: DirectoryPageProps) {
  const headingId = useId();
  const { listRef, headingRef, changeConditions, search, onPageNavigate } =
    useDirectoryNavigation(query);
  const directory = useQuery({
    ...directoryQueryOptions(query, viewer),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery(directoryCategoriesQueryOptions());
  // 一覧の取得の前と失敗の間も期間の選択欄を使えるよう、閲覧者の時計の業務日付で補う
  const [clientToday] = useState(() => businessDateOf(new Date()));
  const signedIn = viewer !== null;
  const context = useMemo<DirectorySectionContext>(
    () => ({ viewer: { signedIn }, query }),
    [signedIn, query],
  );
  const groups = useMemo(() => groupDirectorySections(sections), [sections]);

  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の失敗はブラウザへ渡った後に取得し直した結果で表示を選び直すためでもある
  const error = directory.isFetching ? null : directory.error;
  const data = error === null ? directory.data?.directory : undefined;
  const refetching = data !== undefined && directory.isPlaceholderData;
  const categoryOptions = categories.data?.directoryCategories ?? [];
  const categoryName = categoryOptions.find(
    ({ handle }) => handle === query.category,
  )?.name;

  const retry = () => {
    headingRef.current?.focus();
    void directory.refetch();
    if (categories.isError) {
      void categories.refetch();
    }
  };

  const body = (() => {
    if (error !== null) {
      return (
        <ErrorState
          message={DIRECTORY_LIST_ERROR_MESSAGE}
          onRetry={retry}
          contactHref={
            CLIENT_PROFILE.contactAvailable ? CONTACT_HREF : undefined
          }
        />
      );
    }
    if (data === undefined) {
      return <DirectoryListSkeleton />;
    }
    return (
      <ListBody
        data={data}
        refetching={refetching}
        query={query}
        signedIn={signedIn}
        categoryName={categoryName}
        inserts={inserts}
        metrics={metrics}
        onPageNavigate={onPageNavigate}
      />
    );
  })();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-10 sm:pt-8">
      <SectionSlots sections={groups.banner} context={context} />
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          {DIRECTORY_PAGE_TITLE}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          {DIRECTORY_PAGE_DESCRIPTION}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <SearchForm value={query.q} onSearch={search} />
        <FilterToolbar
          query={query}
          categories={categoryOptions}
          categoriesLoading={categories.isPending}
          businessToday={data?.businessToday ?? clientToday}
          onChange={changeConditions}
        />
      </div>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section
          ref={listRef}
          aria-labelledby={headingId}
          className="min-w-0 flex-1 scroll-mt-20"
        >
          {/* ページの移動と再試行の後のフォーカスの移り先として、プログラムからだけフォーカスできるようにする */}
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="sr-only">
            {DIRECTORY_LIST_HEADING}
          </h2>
          {body}
        </section>
        {groups.aside.length > 0 ? (
          <div
            data-directory-aside=""
            className="flex flex-col gap-6 lg:w-80 lg:shrink-0"
          >
            <SectionSlots sections={groups.aside} context={context} />
          </div>
        ) : null}
      </div>
      {data !== undefined && data.items.length > 0 ? (
        <LaunchCta signedIn={signedIn} />
      ) : null}
      <SectionSlots sections={groups.bottom} context={context} />
    </div>
  );
}
