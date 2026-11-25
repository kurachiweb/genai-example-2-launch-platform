import { useId, useRef } from 'react';

import {
  ADMIN_COMMENT_STATE_LABELS,
  ADMIN_LAUNCH_STATE_LABELS,
} from '../../../../common-lib/moderation/moderation-labels.ts';
import {
  AdminDataTable,
  type AdminDataTableColumn,
  type AdminDataTablePagination,
} from '../../../../lib/components/admin/admin-data-table.tsx';
import { DateTime } from '../../../../lib/components/datetime/date-time.tsx';
import { cn } from '../../../../lib/utilities/class-names.ts';
import type { AdminModerationCommentView } from '../../../graphql/admin-moderation-engagement.ts';
import { ModerationDialogHost } from '../shared/moderation-dialog-host.tsx';
import { ModerationNote } from '../shared/moderation-note.tsx';
import {
  COMMENT_LIST_CAPTION,
  COMMENT_LIST_COLUMNS,
  COMMENT_LIST_EMPTY_MESSAGE,
  commentLaunchLabel,
  EMPTY_COMMENT_BODY_LABEL,
  NO_VALUE_LABEL,
  PRODUCT_DETAIL_COPY,
  productOwnerLabel,
  UNREADABLE_USER_LABEL,
} from '../shared/moderation-messages.ts';
import { CommentModerationActions } from './comment-moderation-actions.tsx';

export interface CommentTableProps {
  // undefinedは読み込み中
  readonly rows: readonly AdminModerationCommentView[] | undefined;
  readonly error?: { readonly message: string; readonly onRetry: () => void };
  readonly pagination: AdminDataTablePagination;
  // 条件を変えて取り直す間。直前の一覧を操作できないまま残す
  readonly refetching: boolean;
}

// 0は取り消したローンチ、nullはローンチを読めない
const launchLabelOf = (launchNumber: number | null): string => {
  if (launchNumber === null) {
    return NO_VALUE_LABEL;
  }
  return launchNumber === 0
    ? ADMIN_LAUNCH_STATE_LABELS.canceled
    : commentLaunchLabel(launchNumber);
};

// 抜粋は利用者の入力のため、マークダウンやHTMLとして解釈せず、改行を保った文字列として示す
function ExcerptCell({ excerpt }: { readonly excerpt: string }) {
  return excerpt === '' ? (
    <span className="text-muted-foreground">{EMPTY_COMMENT_BODY_LABEL}</span>
  ) : (
    <span className="block max-w-md wrap-anywhere whitespace-pre-wrap">
      {excerpt}
    </span>
  );
}

// 管理者が非公開化したコメントには、非公開化した日時と最新の理由を添える
function StateCell({
  comment,
}: {
  readonly comment: AdminModerationCommentView;
}) {
  const label = ADMIN_COMMENT_STATE_LABELS[comment.state];
  if (comment.state !== 'hidden') {
    return <span>{label}</span>;
  }
  return (
    <div className="flex min-w-48 flex-col gap-1">
      <span className="font-medium">{label}</span>
      <ModerationNote
        dateLabel={PRODUCT_DETAIL_COPY.items.hiddenAt}
        occurredAt={null}
        note={comment.latestHide}
      />
    </div>
  );
}

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const COLUMNS: readonly AdminDataTableColumn<AdminModerationCommentView>[] = [
  {
    key: 'body',
    header: COMMENT_LIST_COLUMNS.body,
    cell: (comment) => <ExcerptCell excerpt={comment.excerpt} />,
  },
  {
    key: 'author',
    header: COMMENT_LIST_COLUMNS.author,
    className: 'wrap-anywhere whitespace-normal',
    cell: ({ author }) =>
      author === null
        ? UNREADABLE_USER_LABEL
        : productOwnerLabel(author.nickname, author.handle),
  },
  {
    key: 'product',
    header: COMMENT_LIST_COLUMNS.product,
    className: 'wrap-anywhere whitespace-normal',
    cell: ({ productName }) => productName ?? NO_VALUE_LABEL,
  },
  {
    key: 'launch',
    header: COMMENT_LIST_COLUMNS.launch,
    className: 'whitespace-nowrap',
    cell: ({ launchNumber }) => launchLabelOf(launchNumber),
  },
  {
    key: 'createdAt',
    header: COMMENT_LIST_COLUMNS.createdAt,
    className: 'whitespace-nowrap',
    cell: ({ createdAt }) => (
      <DateTime value={createdAt} format="longDateTime" />
    ),
  },
  {
    key: 'state',
    header: COMMENT_LIST_COLUMNS.state,
    cell: (comment) => <StateCell comment={comment} />,
  },
  {
    key: 'actions',
    header: COMMENT_LIST_COLUMNS.actions,
    cell: (comment) => <CommentModerationActions comment={comment} />,
  },
];

export function CommentTable({
  rows,
  error,
  pagination,
  refetching,
}: CommentTableProps) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 移動の間は押したページ送りのボタンがinertになりフォーカスが<body>へ落ちるため、先にinertの外の一覧の見出しへ移し、新しいページを一覧の先頭から読めるようにする
  const moveToList = () => {
    headingRef.current?.focus({ preventScroll: true });
    sectionRef.current?.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };
  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className="flex scroll-mt-20 flex-col gap-4"
    >
      {/* 再試行や措置の後に消える操作からフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {COMMENT_LIST_CAPTION}
      </h2>
      <ModerationDialogHost fallbackFocusRef={headingRef}>
        <div className="relative" aria-busy={refetching || undefined}>
          {refetching ? (
            <div
              aria-hidden="true"
              className="absolute inset-x-0 -top-2 h-1 rounded-full bg-primary/40"
            />
          ) : null}
          <div
            inert={refetching}
            className={cn(refetching && 'opacity-45 saturate-50')}
          >
            <AdminDataTable
              caption={COMMENT_LIST_CAPTION}
              columns={COLUMNS}
              rows={rows}
              rowKey={(comment) => comment.id}
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
              emptyMessage={COMMENT_LIST_EMPTY_MESSAGE}
              pagination={{
                ...pagination,
                onPrevious: () => {
                  if (pagination.hasPrevious) {
                    moveToList();
                  }
                  pagination.onPrevious();
                },
                onNext: () => {
                  if (pagination.hasNext) {
                    moveToList();
                  }
                  pagination.onNext();
                },
              }}
            />
          </div>
        </div>
      </ModerationDialogHost>
    </section>
  );
}
