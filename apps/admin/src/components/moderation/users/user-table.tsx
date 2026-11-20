import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

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
import {
  QUARANTINED_IMAGE_MARK,
  USER_LIST_CAPTION,
  USER_LIST_COLUMNS,
  USER_LIST_EMPTY_MESSAGE,
  userHandleLabel,
} from '../shared/moderation-messages.ts';
import { AdministrativeWithdrawalAction } from './administrative-withdrawal-action.tsx';
import { AdministrativeWithdrawalDialog } from './administrative-withdrawal-dialog.tsx';
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

// 操作の列は、措置の操作の後のフォーカスの移り先を持つ表の側で描く
const columnsOf = (
  actionsOf: (user: AdminModerationUserView) => ReactNode,
): readonly AdminDataTableColumn<AdminModerationUserView>[] => [
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
      <div className="flex flex-wrap gap-2">{actionsOf(user)}</div>
    ),
  },
];

interface WithdrawalState {
  readonly open: boolean;
  // 確定で行が消えても確認を開いたまま結果を示し、閉じる動きの間も題名を保つため、閉じても対象を残す
  readonly target: AdminModerationUserView | undefined;
  // 閉じる動きの最中に別の利用者で開き直すと前の入力が残るため、開くたびに数を変えて作り直す
  readonly session: number;
}

const WITHDRAWAL_CLOSED: WithdrawalState = Object.freeze({
  open: false,
  target: undefined,
  session: 0,
});

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
  const [withdrawal, setWithdrawal] =
    useState<WithdrawalState>(WITHDRAWAL_CLOSED);
  // 代理の退会に成功すると開いた元の行が消えるため、その時だけ一覧の見出しを戻り先にし、取り消しでは開いた元のボタンへ戻す
  const withdrawnReturnFocusRef = useRef<HTMLElement | null>(null);
  const openWithdrawal = (user: AdminModerationUserView): void => {
    withdrawnReturnFocusRef.current = null;
    setWithdrawal((current) => ({
      open: true,
      target: user,
      session: current.session + 1,
    }));
  };
  const actionsOf = (user: AdminModerationUserView) => (
    <>
      <UserModerationActions user={user} returnFocusRef={headingRef} />
      <AdministrativeWithdrawalAction user={user} onOpen={openWithdrawal} />
    </>
  );
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
            columns={columnsOf(actionsOf)}
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
      {withdrawal.target === undefined ? null : (
        <AdministrativeWithdrawalDialog
          key={withdrawal.session}
          open={withdrawal.open}
          onOpenChange={(open) => {
            setWithdrawal((current) => ({ ...current, open }));
          }}
          target={withdrawal.target}
          onCompleted={() => {
            withdrawnReturnFocusRef.current = headingRef.current;
          }}
          returnFocusRef={withdrawnReturnFocusRef}
        />
      )}
    </section>
  );
}
