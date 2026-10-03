import { Link } from '@tanstack/react-router';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { buttonVariants } from '#/components/ui/button';
import { cn } from '#/lib/utils';

import { useDirectoryFormat } from './use-directory-format';

type Props = {
  page: number;
  pageCount: number;
  // ページ移動後に一覧の先頭へスクロールし、見出しにフォーカスを移す
  onNavigate: () => void;
};

// 先頭・末尾・現在ページの前後1つを出し、間を「…」で省略する。1ページ分しか空かない場合は省略せずその番号を出す
function pageItems(page: number, pageCount: number): (number | 'gap')[] {
  const pages = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((value) => value >= 1 && value <= pageCount)
    .sort((a, b) => a - b);
  return pages.flatMap((value, index) => {
    const previous = pages[index - 1] as number | undefined;
    if (previous === undefined || value - previous === 1) return [value];
    if (value - previous === 2) return [previous + 1, value];
    return ['gap' as const, value];
  });
}

export function Pagination({ page, pageCount, onNavigate }: Props) {
  const format = useDirectoryFormat();
  if (pageCount <= 1) return null;

  const pageLink = (
    target: number,
    content: React.ReactNode,
    options: { label?: string; current?: boolean; className?: string } = {},
  ) => {
    const disabled = target < 1 || target > pageCount;
    const className = cn(
      buttonVariants({
        variant: options.current ? 'default' : 'outline',
        size: 'sm',
      }),
      'min-w-9 tabular-nums',
      options.className,
    );
    if (disabled) {
      return (
        <span
          aria-disabled="true"
          className={cn(className, 'pointer-events-none opacity-50')}
        >
          {content}
        </span>
      );
    }
    return (
      <Link
        from="/client/p/"
        to="/client/p"
        search={(prev) => ({ ...prev, page: target > 1 ? target : undefined })}
        resetScroll={false}
        onClick={onNavigate}
        aria-label={options.label}
        aria-current={options.current ? 'page' : undefined}
        className={className}
      >
        {content}
      </Link>
    );
  };

  const previous = pageLink(
    page - 1,
    <>
      <ChevronLeftIcon aria-hidden="true" />
      前へ
    </>,
    { label: '前のページ' },
  );
  const next = pageLink(
    page + 1,
    <>
      次へ
      <ChevronRightIcon aria-hidden="true" />
    </>,
    { label: '次のページ' },
  );

  return (
    <nav aria-label="ページ送り" className="mt-8">
      <ul className="hidden flex-wrap items-center justify-center gap-1.5 sm:flex">
        <li>{previous}</li>
        {pageItems(page, pageCount).map((item, index) =>
          item === 'gap' ? (
            <li
              key={`gap-${index}`}
              aria-hidden="true"
              className="px-1 text-muted-foreground"
            >
              …
            </li>
          ) : (
            <li key={item}>
              {pageLink(item, format.number(item), {
                label: `${item}ページ目`,
                current: item === page,
              })}
            </li>
          ),
        )}
        <li>{next}</li>
      </ul>
      <div className="flex items-center justify-between gap-3 sm:hidden">
        {previous}
        <p className="text-sm text-muted-foreground">
          <span className="sr-only">現在のページ</span>
          <span className="scoreboard-digits text-base text-foreground">
            {format.number(page)}
          </span>
          <span aria-hidden="true"> / </span>
          <span className="sr-only">全</span>
          {format.number(pageCount)}
          <span className="sr-only">ページ</span>
        </p>
        {next}
      </div>
    </nav>
  );
}
