import { useSuspenseQuery } from '@tanstack/react-query';
import { UserPlusIcon } from 'lucide-react';
import { useState } from 'react';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  adminAccountsQueryOptions,
  toAdminAccounts,
} from '../../graphql/admin-accounts.ts';
import { canInviteAdmins } from '../admins/admin-account-permissions.ts';
import {
  ADMIN_ACCOUNTS_DESCRIPTION,
  ADMIN_ACCOUNTS_TITLE,
  INVITE_ADMIN_LABEL,
} from '../admins/admin-accounts-messages.ts';
import { AdminList } from '../admins/admin-list.tsx';
import { InviteAdminDialog } from '../admins/invite-admin-dialog.tsx';
import { useAdminRole } from '../layout/use-current-admin.ts';

export function AdminsPage() {
  const { data: accounts } = useSuspenseQuery({
    ...adminAccountsQueryOptions(),
    select: toAdminAccounts,
  });
  const role = useAdminRole();
  // 閉じる動きの最中に開き直すと前の入力が残るため、開くたびに数を変えて入力欄を作り直す
  const [invitation, setInvitation] = useState({ open: false, session: 0 });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={ADMIN_ACCOUNTS_TITLE}
        description={ADMIN_ACCOUNTS_DESCRIPTION}
        {...(canInviteAdmins(role)
          ? {
              actions: (
                <Button
                  type="button"
                  onClick={() => {
                    setInvitation((current) => ({
                      open: true,
                      session: current.session + 1,
                    }));
                  }}
                >
                  <UserPlusIcon aria-hidden="true" />
                  {INVITE_ADMIN_LABEL}
                </Button>
              ),
            }
          : {})}
      />
      <AdminList accounts={accounts} />
      <InviteAdminDialog
        key={invitation.session}
        open={invitation.open}
        onOpenChange={(open) => {
          setInvitation((current) => ({ ...current, open }));
        }}
      />
    </div>
  );
}
