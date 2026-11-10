import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  NEXT_PAGE_LABEL,
  PREVIOUS_PAGE_LABEL,
} from '../../../lib/utilities/messages/pagination-messages.ts';
import { formatNumber } from '../../../lib/utilities/number/number-format.ts';
import { directoryPageHref } from './directory-href.ts';
import { directoryPaginationItems } from './directory-pagination-items.ts';
import {
  CURRENT_PAGE_PREFIX,
  DIRECTORY_PAGINATION_LABEL,
  PAGE_COUNT_PREFIX,
  PAGE_COUNT_SUFFIX,
  PAGE_GAP_MARK,
  pageNumberName,
} from './directory-pagination-messages.ts';
import { UnmarkedPathLink } from './unmarked-path-link.tsx';

export interface DirectoryPaginationProps {
  // 表示中の一覧の条件。ページ以外の条件を保ったリンクを作る
  readonly query: DirectoryQuery;
  readonly pageCount: number;
  // 遷移はリンクが行い、一覧の先頭へのスクロールとフォーカスの移動のために、移る先のページ(1から)を知らせる
  readonly onNavigate?: ((page: number) => void) | undefined;
}

// 修飾キー付きや中ボタンの押下は新しいタブなどで開くため、表示中の一覧のページの移動として扱わない
const isInPageNavigation = (event: MouseEvent): boolean =>
  event.button === 0 &&
  !event.metaKey &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.shiftKey;

function PageLink({
  query,
  target,
  current = false,
  label,
  onNavigate,
  className,
  children,
}: {
  readonly query: DirectoryQuery;
  readonly target: number;
  readonly current?: boolean;
  readonly label?: string;
  readonly onNavigate: ((page: number) => void) | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <Button
      asChild
      variant={current ? 'default' : 'outline'}
      size="sm"
      className={className}
    >
      <UnmarkedPathLink
        href={directoryPageHref(query, target)}
        current={current}
        aria-label={label}
        onClick={(event) => {
          if (!current && isInPageNavigation(event)) {
            onNavigate?.(target);
          }
        }}
      >
        {children}
      </UnmarkedPathLink>
    </Button>
  );
}

// 先頭・末尾で移る先が無い側はリンクにしない(aria-disabledのリンクはEnterで移動する)。ページの移動の後は呼び出し元が一覧の見出しへフォーカスを移すため、フォーカスを保つ必要は無くdisabledにする
function StepLink({
  query,
  target,
  enabled,
  onNavigate,
  children,
}: {
  readonly query: DirectoryQuery;
  readonly target: number;
  readonly enabled: boolean;
  readonly onNavigate: ((page: number) => void) | undefined;
  readonly children: ReactNode;
}) {
  if (!enabled) {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <PageLink query={query} target={target} onNavigate={onNavigate}>
      {children}
    </PageLink>
  );
}

export function DirectoryPagination({
  query,
  pageCount,
  onNavigate,
}: DirectoryPaginationProps) {
  const preferences = useDisplayPreferences();
  if (pageCount <= 1) {
    return null;
  }
  const page = query.page ?? 1;
  const format = (value: number) => formatNumber(value, preferences);
  return (
    <nav
      aria-label={DIRECTORY_PAGINATION_LABEL}
      className="flex items-center justify-between gap-3 md:justify-center md:gap-1.5"
    >
      <StepLink
        query={query}
        target={page - 1}
        enabled={page > 1}
        onNavigate={onNavigate}
      >
        <ChevronLeftIcon aria-hidden="true" />
        {PREVIOUS_PAGE_LABEL}
      </StepLink>
      <ul className="hidden flex-wrap items-center justify-center gap-1.5 md:flex">
        {directoryPaginationItems(page, pageCount).map((item) =>
          item.kind === 'gap' ? (
            <li
              key={`gap-after-${String(item.after)}`}
              aria-hidden="true"
              className="px-1 text-muted-foreground"
            >
              {PAGE_GAP_MARK}
            </li>
          ) : (
            <li key={item.page}>
              <PageLink
                query={query}
                target={item.page}
                current={item.current}
                label={pageNumberName(format(item.page))}
                onNavigate={onNavigate}
                className="min-w-9 tabular-nums"
              >
                {format(item.page)}
              </PageLink>
            </li>
          ),
        )}
      </ul>
      <p
        data-page-counter
        className="text-sm text-muted-foreground tabular-nums md:hidden"
      >
        <span className="sr-only">{CURRENT_PAGE_PREFIX}</span>
        <span className="text-base font-semibold text-foreground">
          {format(page)}
        </span>
        <span aria-hidden="true"> / </span>
        <span className="sr-only">{PAGE_COUNT_PREFIX}</span>
        {format(pageCount)}
        <span className="sr-only">{PAGE_COUNT_SUFFIX}</span>
      </p>
      <StepLink
        query={query}
        target={page + 1}
        enabled={page < pageCount}
        onNavigate={onNavigate}
      >
        {NEXT_PAGE_LABEL}
        <ChevronRightIcon aria-hidden="true" />
      </StepLink>
    </nav>
  );
}
