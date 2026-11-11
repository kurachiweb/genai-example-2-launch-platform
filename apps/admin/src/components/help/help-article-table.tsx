import { Link } from '@tanstack/react-router';
import { useId, useRef } from 'react';

import { AdminAvatar } from '../../../lib/components/admin/admin-avatar.tsx';
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from '../../../lib/components/admin/admin-data-table.tsx';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import type { AdminHelpArticleRowView } from '../../graphql/admin-help-articles.ts';
import {
  filterHelpArticles,
  type HelpArticleFilter,
} from './help-article-filter.ts';
import { HelpArticleStatusBadge } from './help-article-status-badge.tsx';
import {
  HELP_ARTICLE_LIST_CAPTION,
  HELP_ARTICLE_LIST_COLUMNS,
  HELP_ARTICLE_PINNED_LABEL,
  HELP_ARTICLE_UNPINNED_LABEL,
  HELP_ARTICLES_EMPTY_MESSAGE,
  HELP_ARTICLES_NO_MATCH_MESSAGE,
  HELP_DELETED_AUTHOR_LABEL,
} from './help-messages.ts';

export interface HelpArticleTableProps {
  // 絞り込む前の全件。undefinedは読み込み中
  readonly articles: readonly AdminHelpArticleRowView[] | undefined;
  readonly filter: HelpArticleFilter;
  readonly error?: { readonly message: string; readonly onRetry: () => void };
}

const AVATAR_SIZE = 32;

// 名前を隣に書くため、画像は飾りにする。削除済みの管理者は固定の名前から作る既定の画像にし、誰の記事でも同じ見た目にする
function CreatorCell({ row }: { readonly row: AdminHelpArticleRowView }) {
  const nickname = row.creator?.nickname ?? HELP_DELETED_AUTHOR_LABEL;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <AdminAvatar
        image={row.creator?.avatar ?? null}
        nickname={nickname}
        size={AVATAR_SIZE}
        className="size-8 shrink-0 object-cover"
      />
      <span
        className={
          row.creator === null
            ? 'wrap-anywhere text-muted-foreground'
            : 'wrap-anywhere'
        }
      >
        {nickname}
      </span>
    </span>
  );
}

const COLUMNS: readonly AdminDataTableColumn<AdminHelpArticleRowView>[] = [
  {
    key: 'title',
    header: HELP_ARTICLE_LIST_COLUMNS.title,
    cell: (row) => (
      <Link
        to="/help-articles/$articleId"
        params={{ articleId: row.id }}
        className="font-medium wrap-anywhere text-foreground underline underline-offset-4"
      >
        {row.title}
      </Link>
    ),
  },
  {
    key: 'handle',
    header: HELP_ARTICLE_LIST_COLUMNS.handle,
    cell: (row) => <span className="wrap-anywhere">{row.handle}</span>,
  },
  {
    key: 'category',
    header: HELP_ARTICLE_LIST_COLUMNS.category,
    cell: (row) => <span className="wrap-anywhere">{row.categoryName}</span>,
  },
  {
    key: 'status',
    header: HELP_ARTICLE_LIST_COLUMNS.status,
    cell: (row) => <HelpArticleStatusBadge status={row.status} />,
    className: 'whitespace-nowrap',
  },
  {
    key: 'pinned',
    header: HELP_ARTICLE_LIST_COLUMNS.pinned,
    cell: (row) =>
      row.pinned ? (
        HELP_ARTICLE_PINNED_LABEL
      ) : (
        <span className="text-muted-foreground">
          {HELP_ARTICLE_UNPINNED_LABEL}
        </span>
      ),
    className: 'whitespace-nowrap',
  },
  {
    key: 'creator',
    header: HELP_ARTICLE_LIST_COLUMNS.creator,
    cell: (row) => <CreatorCell row={row} />,
  },
  {
    key: 'updatedAt',
    header: HELP_ARTICLE_LIST_COLUMNS.updatedAt,
    cell: (row) => <DateTime value={row.updatedAt} format="longDateTime" />,
    className: 'whitespace-nowrap',
  },
];

// 全件を1回で読んで画面で絞り込むため、ページ送りを持たない
export function HelpArticleTable({
  articles,
  filter,
  error,
}: HelpArticleTableProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rows =
    articles === undefined ? undefined : filterHelpArticles(articles, filter);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="sr-only">
        {HELP_ARTICLE_LIST_CAPTION}
      </h2>
      <AdminDataTable
        caption={HELP_ARTICLE_LIST_CAPTION}
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.id}
        {...(error === undefined
          ? {}
          : {
              error: {
                message: error.message,
                onRetry: () => {
                  headingRef.current?.focus();
                  error.onRetry();
                },
              },
            })}
        emptyMessage={
          articles?.length === 0
            ? HELP_ARTICLES_EMPTY_MESSAGE
            : HELP_ARTICLES_NO_MATCH_MESSAGE
        }
      />
    </section>
  );
}
