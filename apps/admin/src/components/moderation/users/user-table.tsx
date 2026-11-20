import { useRouter } from '@tanstack/react-router';
import { useEffect, useId, useRef } from 'react';

import { DISPOSABLE_EMAIL_LABELS } from '../../../../common-lib/moderation/moderation-labels.ts';
import {
  AdminDataTable,
  type AdminDataTableColumn,
  type AdminDataTablePagination,
} from '../../../../lib/components/admin/admin-data-table.tsx';
import { DateTime } from '../../../../lib/components/datetime/date-time.tsx';
import { Badge } from '../../../../lib/components/ui/badge/badge.tsx';
import { cn } from '../../../../lib/utilities/class-names.ts';
import type { AdminModerationUserView } from '../../../graphql/admin-moderation-users.ts';
import { AdminMediaImage } from '../shared/admin-media-image.tsx';
import { ModerationDialogHost } from '../shared/moderation-dialog-host.tsx';
import {
  QUARANTINED_IMAGE_MARK,
  USER_LIST_CAPTION,
  USER_LIST_COLUMNS,
  USER_LIST_EMPTY_MESSAGE,
  userHandleLabel,
} from '../shared/moderation-messages.ts';
import { AdministrativeWithdrawalAction } from './administrative-withdrawal-action.tsx';
import { UserModerationActions } from './user-moderation-actions.tsx';
import { UserStatusCell } from './user-status-cell.tsx';

export interface UserTableProps {
  // undefinedは読み込み中
  readonly rows: readonly AdminModerationUserView[] | undefined;
  readonly error?: { readonly message: string; readonly onRetry: () => void };
  readonly pagination: AdminDataTablePagination;
  // 条件を変えて取り直す間。直前の一覧を操作できないまま残す
  readonly refetching: boolean;
}

const AVATAR_DISPLAY = Object.freeze({ kind: 'square', size: 32 } as const);

// 隣の列にニックネームを示すため、画像は飾りとして名前を付けない
function AvatarCell({ user }: { readonly user: AdminModerationUserView }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <AdminMediaImage
        file={user.avatar}
        display={AVATAR_DISPLAY}
        alt=""
        placeholder={{ label: user.nickname, seed: user.id }}
        className="rounded-full"
      />
      {user.avatar?.quarantined === true ? (
        <Badge variant="outline">{QUARANTINED_IMAGE_MARK}</Badge>
      ) : null}
    </div>
  );
}

const COLUMNS: readonly AdminDataTableColumn<AdminModerationUserView>[] = [
  {
    key: 'avatar',
    header: USER_LIST_COLUMNS.avatar,
    cell: (user) => <AvatarCell user={user} />,
  },
  {
    key: 'nickname',
    header: USER_LIST_COLUMNS.nickname,
    cell: (user) => <span className="wrap-anywhere">{user.nickname}</span>,
  },
  {
    key: 'handle',
    header: USER_LIST_COLUMNS.handle,
    cell: (user) => (
      <span translate="no" className="wrap-anywhere">
        {userHandleLabel(user.handle)}
      </span>
    ),
  },
  {
    key: 'registeredAt',
    header: USER_LIST_COLUMNS.registeredAt,
    cell: (user) => (
      <DateTime value={user.registeredAt} format="longDateTime" />
    ),
    className: 'whitespace-nowrap',
  },
  {
    key: 'disposableEmail',
    header: USER_LIST_COLUMNS.disposableEmail,
    cell: (user) => DISPOSABLE_EMAIL_LABELS[user.disposableEmail],
    className: 'whitespace-nowrap',
  },
  {
    key: 'status',
    header: USER_LIST_COLUMNS.status,
    cell: (user) => <UserStatusCell user={user} />,
  },
  {
    key: 'actions',
    header: USER_LIST_COLUMNS.actions,
    cell: (user) => (
      <div className="flex flex-wrap gap-2">
        <UserModerationActions user={user} />
        <AdministrativeWithdrawalAction user={user} />
      </div>
    ),
  },
];

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function UserTable({
  rows,
  error,
  pagination,
  refetching,
}: UserTableProps) {
  const router = useRouter();
  const headingId = useId();
  const pendingRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      pendingRef.current?.();
    },
    [],
  );
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moveToList = () => {
    headingRef.current?.focus({ preventScroll: true });
    sectionRef.current?.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };
  // 移動の間は押したページ送りのボタンがinertになりフォーカスが<body>へ落ちるため、先にinertの外の一覧の見出しへ移す。ルーターは描画の後にスクロールを先頭へ戻すため、描画の後にもう一度一覧の先頭へ移る
  const beforePageMove = () => {
    moveToList();
    pendingRef.current?.();
    const unsubscribe = router.subscribe('onRendered', () => {
      unsubscribe();
      pendingRef.current = null;
      moveToList();
    });
    pendingRef.current = unsubscribe;
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
        {USER_LIST_CAPTION}
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
              caption={USER_LIST_CAPTION}
              columns={COLUMNS}
              rows={rows}
              rowKey={(user) => user.id}
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
              emptyMessage={USER_LIST_EMPTY_MESSAGE}
              pagination={{
                ...pagination,
                onPrevious: () => {
                  if (pagination.hasPrevious) {
                    beforePageMove();
                  }
                  pagination.onPrevious();
                },
                onNext: () => {
                  if (pagination.hasNext) {
                    beforePageMove();
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
