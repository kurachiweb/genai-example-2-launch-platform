import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { LogOutIcon, UserIcon } from 'lucide-react';

import { ADMIN_ROLE_LABELS } from '../../../common-lib/admin/admin-roles.ts';
import { AdminAvatar } from '../../../lib/components/admin/admin-avatar.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { DropdownMenu } from '../../../lib/components/ui/dropdown-menu/dropdown-menu.tsx';
import { DropdownMenuContent } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-content.tsx';
import { DropdownMenuItem } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-item.tsx';
import { DropdownMenuLabel } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-label.tsx';
import { DropdownMenuSeparator } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-separator.tsx';
import { DropdownMenuTrigger } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-trigger.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import { AdminLogoutDocument } from '../../graphql/generated/graphql.ts';
import { useAdminViewer } from '../auth/use-admin-viewer.ts';
import { useAdminViewerRefresh } from '../auth/use-admin-viewer-refresh.ts';
import {
  ADMIN_ACCOUNT_LINK,
  ADMIN_LOGGED_OUT_MESSAGE,
  ADMIN_LOGOUT_LABEL,
} from './admin-shell-messages.ts';

// 未ログインでは認証の画面・404・エラーのページに何も描かない。管理者側には新規登録が無く、未ログインで開ける画面は認証の画面だけのため、ログインへの導線も置かない
export function AdminAccountMenu() {
  const viewer = useAdminViewer();
  const refreshViewer = useAdminViewerRefresh();
  // セッションのCookieはAPIの応答の指示で消える。その後に管理者を取り直し、ログイン必須のページではルートの判定でログイン画面へ移す
  const logout = useMutation({
    ...graphqlMutationOptions(AdminLogoutDocument),
    onSuccess: async () => {
      notify.success(ADMIN_LOGGED_OUT_MESSAGE);
      await refreshViewer();
    },
    onError: (error) => {
      notify.error(errorMessageOf(error, ADMIN_PROFILE.contactAvailable));
    },
  });

  if (viewer === null) {
    return null;
  }

  const roleLabel = ADMIN_ROLE_LABELS[viewer.role];

  const handleLogout = (): void => {
    if (!logout.isPending) {
      logout.mutate({ variables: {} });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex max-w-full min-w-0 items-center gap-2 rounded-full border border-border bg-card p-0.5 text-left text-sm hover:bg-accent sm:pr-3"
        >
          <AdminAvatar
            image={viewer.avatar}
            nickname={viewer.nickname}
            size={32}
            className="size-8 shrink-0"
          />
          {/* 狭い画面ではアバターだけを見せ、ニックネームとロールはボタンの名前として残す */}
          <span className="sr-only min-w-0 flex-col leading-tight sm:not-sr-only sm:flex">
            <span className="max-w-40 font-medium wrap-anywhere">
              {viewer.nickname}
            </span>
            <span className="text-xs text-muted-foreground">{roleLabel}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="wrap-anywhere">
          {viewer.nickname}
          <span className="block text-xs font-normal text-muted-foreground">
            {roleLabel}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={ADMIN_ACCOUNT_LINK.to}>
            <UserIcon aria-hidden="true" />
            {ADMIN_ACCOUNT_LINK.label}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleLogout}>
          <LogOutIcon aria-hidden="true" />
          {ADMIN_LOGOUT_LABEL}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
