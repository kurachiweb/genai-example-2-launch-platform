import { useMutation } from '@tanstack/react-query';
import { MailIcon, PencilIcon, ShieldIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';

import { ADMIN_ROLE_LABELS } from '../../../common-lib/admin/admin-roles.ts';
import { AdminAvatar } from '../../../lib/components/admin/admin-avatar.tsx';
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from '../../../lib/components/admin/admin-data-table.tsx';
import { ConfirmActionDialog } from '../../../lib/components/admin/confirm-action-dialog.tsx';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import type { AdminAccount } from '../../graphql/admin-accounts.ts';
import {
  AdminDeleteDocument,
  AdminResendInvitationDocument,
} from '../../graphql/generated/graphql.ts';
import { useCurrentAdmin } from '../layout/use-current-admin.ts';
import { adminAccountLabelOf } from './admin-account-label.ts';
import {
  type AdminAccountActions,
  accountActionsOf,
} from './admin-account-permissions.ts';
import {
  ADMIN_DELETED_MESSAGE,
  ADMIN_LIST_COLUMNS,
  ADMIN_LIST_EMPTY_MESSAGE,
  ADMIN_LIST_HEADING,
  ADMIN_STATUS_LABELS,
  CHANGE_ROLE_LABEL,
  DELETE_ACTIVE_ADMIN_DESCRIPTION,
  DELETE_ADMIN_CONFIRM_LABEL,
  DELETE_ADMIN_LABEL,
  DELETE_INVITED_ADMIN_DESCRIPTION,
  deleteAdminTitle,
  EDIT_PROFILE_LABEL,
  INVITATION_RESENT_MESSAGE,
  NOT_SET_LABEL,
  RESEND_INVITATION_CONFIRM_LABEL,
  RESEND_INVITATION_DESCRIPTION,
  RESEND_INVITATION_LABEL,
  resendInvitationTitle,
  ROW_ACTION_NAMES,
  SELF_LABEL,
} from './admin-accounts-messages.ts';
import { AdminProfileDialog } from './admin-profile-dialog.tsx';
import { ChangeRoleDialog } from './change-role-dialog.tsx';
import { useAdminAccountsRefresh } from './use-admin-accounts-refresh.ts';

export interface AdminListProps {
  // APIの返した登録の新しい順
  readonly accounts: readonly AdminAccount[];
}

type RowActionKind = keyof AdminAccountActions;

interface DialogState {
  readonly kind: RowActionKind | undefined;
  // 閉じる動きの間も題名を保つため、閉じても対象を残す
  readonly account: AdminAccount | undefined;
  // 閉じる動きの最中に開き直すと前の入力が残るため、開くたびに数を変えて入力欄を作り直す
  readonly session: number;
}

const CLOSED: DialogState = Object.freeze({
  kind: undefined,
  account: undefined,
  session: 0,
});

const ROW_ACTIONS: readonly {
  readonly kind: RowActionKind;
  readonly label: string;
  readonly icon: ReactNode;
}[] = [
  {
    kind: 'resend',
    label: RESEND_INVITATION_LABEL,
    icon: <MailIcon aria-hidden="true" />,
  },
  {
    kind: 'changeRole',
    label: CHANGE_ROLE_LABEL,
    icon: <ShieldIcon aria-hidden="true" />,
  },
  {
    kind: 'editProfile',
    label: EDIT_PROFILE_LABEL,
    icon: <PencilIcon aria-hidden="true" />,
  },
  {
    kind: 'delete',
    label: DELETE_ADMIN_LABEL,
    icon: <Trash2Icon aria-hidden="true" />,
  },
];

const STATUS_BADGE_VARIANTS = Object.freeze({
  active: 'secondary',
  invited: 'outline',
  invitation_expired: 'destructive',
} as const);

const notSet = <span className="text-muted-foreground">{NOT_SET_LABEL}</span>;

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

export function AdminList({ accounts }: AdminListProps) {
  const viewer = useCurrentAdmin();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 削除や自分のロールを下げる変更に成功すると開いた元の操作が消えるため、その時だけ見出しを戻り先にし、取り消しや操作が残る時は開いた元のボタンへ戻す
  const vanishedOpenerReturnFocusRef = useRef<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<DialogState>(CLOSED);
  const refreshAccounts = useAdminAccountsRefresh();
  const resend = useMutation(
    graphqlMutationOptions(AdminResendInvitationDocument),
  );
  const remove = useMutation(graphqlMutationOptions(AdminDeleteDocument));
  const target = dialog.account;
  const targetLabel = target === undefined ? '' : adminAccountLabelOf(target);

  const openDialog = (kind: RowActionKind, account: AdminAccount): void => {
    vanishedOpenerReturnFocusRef.current = null;
    setDialog((current) => ({
      kind,
      account,
      session: current.session + 1,
    }));
  };

  const dialogProps = (kind: RowActionKind) => ({
    open: dialog.kind === kind,
    onOpenChange: (open: boolean) => {
      if (!open) {
        setDialog((current) => ({ ...current, kind: undefined }));
      }
    },
  });

  const columns: readonly AdminDataTableColumn<AdminAccount>[] = [
    {
      key: 'avatar',
      header: ADMIN_LIST_COLUMNS.avatar,
      cell: (account) => (
        <AdminAvatar
          image={account.avatar}
          nickname={adminAccountLabelOf(account)}
          size={32}
        />
      ),
    },
    {
      key: 'nickname',
      header: ADMIN_LIST_COLUMNS.nickname,
      cell: (account) => (
        <span className="flex flex-wrap items-center gap-2">
          {account.nickname ?? notSet}
          {account.id === viewer.id ? (
            <Badge variant="outline">{SELF_LABEL}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'title',
      header: ADMIN_LIST_COLUMNS.title,
      cell: (account) => account.title ?? notSet,
    },
    {
      key: 'email',
      header: ADMIN_LIST_COLUMNS.email,
      cell: (account) => (
        <span translate="no" className="break-all">
          {account.email}
        </span>
      ),
    },
    {
      key: 'role',
      header: ADMIN_LIST_COLUMNS.role,
      cell: (account) => ADMIN_ROLE_LABELS[account.role],
    },
    {
      key: 'status',
      header: ADMIN_LIST_COLUMNS.status,
      cell: (account) => (
        <Badge variant={STATUS_BADGE_VARIANTS[account.status]}>
          {ADMIN_STATUS_LABELS[account.status]}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      header: ADMIN_LIST_COLUMNS.createdAt,
      cell: (account) => (
        <DateTime value={account.createdAt} format="dateTime" />
      ),
    },
    {
      key: 'actions',
      header: ADMIN_LIST_COLUMNS.actions,
      className: 'text-end',
      cell: (account) => {
        const allowed = accountActionsOf(viewer, account);
        const name = adminAccountLabelOf(account);
        return (
          <span className="flex flex-wrap justify-end gap-2">
            {ROW_ACTIONS.filter(({ kind }) => allowed[kind]).map(
              ({ kind, label, icon }) => (
                <Button
                  key={kind}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    openDialog(kind, account);
                  }}
                >
                  {icon}
                  {/* 画面に見えない要素と見えている文言を並べると、名前の計算で間に空白が入るため、名前は読み上げだけの要素にまとめて持たせる */}
                  <span aria-hidden="true">{label}</span>
                  <span className="sr-only">
                    {ROW_ACTION_NAMES[kind](name)}
                  </span>
                </Button>
              ),
            )}
          </span>
        );
      },
    },
  ];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* 削除で開いた元の行が消えた後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {ADMIN_LIST_HEADING}
      </h2>
      <AdminDataTable
        caption={ADMIN_LIST_HEADING}
        columns={columns}
        rows={accounts}
        rowKey={(account) => account.id}
        emptyMessage={ADMIN_LIST_EMPTY_MESSAGE}
      />
      <ConfirmActionDialog
        key={`resend-${String(dialog.session)}`}
        {...dialogProps('resend')}
        title={resendInvitationTitle(targetLabel)}
        description={RESEND_INVITATION_DESCRIPTION}
        confirmLabel={RESEND_INVITATION_CONFIRM_LABEL}
        reason="optional"
        audited
        onConfirm={async ({ reason }) => {
          if (target === undefined) {
            return;
          }
          await resend.mutateAsync({ variables: { id: target.id, reason } });
          notify.success(INVITATION_RESENT_MESSAGE);
          await refreshAccounts();
        }}
        failureMessageOf={failureMessageOf}
      />
      <ConfirmActionDialog
        key={`delete-${String(dialog.session)}`}
        {...dialogProps('delete')}
        title={deleteAdminTitle(targetLabel)}
        description={
          target?.status === 'active'
            ? DELETE_ACTIVE_ADMIN_DESCRIPTION
            : DELETE_INVITED_ADMIN_DESCRIPTION
        }
        confirmLabel={DELETE_ADMIN_CONFIRM_LABEL}
        reason="optional"
        audited
        onConfirm={async ({ reason }) => {
          if (target === undefined) {
            return;
          }
          await remove.mutateAsync({ variables: { id: target.id, reason } });
          vanishedOpenerReturnFocusRef.current = headingRef.current;
          notify.success(ADMIN_DELETED_MESSAGE);
          await refreshAccounts();
        }}
        failureMessageOf={failureMessageOf}
        returnFocusRef={vanishedOpenerReturnFocusRef}
      />
      <ChangeRoleDialog
        key={`changeRole-${String(dialog.session)}`}
        {...dialogProps('changeRole')}
        account={target}
        onChanged={(account, role) => {
          if (
            account.id === viewer.id &&
            !accountActionsOf({ id: viewer.id, role }, account).changeRole
          ) {
            vanishedOpenerReturnFocusRef.current = headingRef.current;
          }
        }}
        returnFocusRef={vanishedOpenerReturnFocusRef}
      />
      <AdminProfileDialog
        key={`editProfile-${String(dialog.session)}`}
        {...dialogProps('editProfile')}
        account={target}
      />
    </section>
  );
}
