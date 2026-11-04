import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import type { AdminAccount } from '../../graphql/admin-accounts.ts';
import { AdminUpdateProfileDocument } from '../../graphql/generated/graphql.ts';
import { ADMIN_PROFILE_FORM_SCHEMA } from './admin-account-form-schemas.ts';
import { adminAccountLabelOf } from './admin-account-label.ts';
import {
  ADMIN_TITLE_DESCRIPTION,
  ADMIN_TITLE_LABEL,
  AVATAR_DESCRIPTION,
  AVATAR_LABEL,
  editProfileTitle,
  NICKNAME_DESCRIPTION,
  NICKNAME_LABEL,
  PROFILE_SAVED_MESSAGE,
  PROFILE_SUBMIT_LABEL,
} from './admin-accounts-messages.ts';
import { AdminAvatarField } from './admin-avatar-field.tsx';
import { AdminFormDialog } from './admin-form-dialog.tsx';
import { useAdminFormDialogControls } from './admin-form-dialog-controls.ts';
import { AdminFormDialogFooter } from './admin-form-dialog-footer.tsx';
import { useAdminAccountsRefresh } from './use-admin-accounts-refresh.ts';

export interface AdminProfileDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  // 閉じる動きの間も題名を保つため、閉じても対象を残す
  readonly account: AdminAccount | undefined;
}

interface AdminProfileFormProps {
  readonly account: AdminAccount;
}

function AdminProfileForm({ account }: AdminProfileFormProps) {
  const { pending, run, cancel } = useAdminFormDialogControls();
  const form = useAppForm(ADMIN_PROFILE_FORM_SCHEMA, {
    defaultValues: {
      nickname: account.nickname ?? '',
      title: account.title ?? '',
      avatarFileId: account.avatar?.id ?? null,
    },
  });
  const updateProfile = useMutation(
    graphqlMutationOptions(AdminUpdateProfileDocument),
  );
  const refreshAccounts = useAdminAccountsRefresh();
  const [failure, setFailure] = useState<string>();

  return (
    <AppForm
      form={form}
      onSubmit={(values) =>
        run(async () => {
          setFailure(undefined);
          await updateProfile.mutateAsync({
            variables: { id: account.id, ...values },
          });
          notify.success(PROFILE_SAVED_MESSAGE);
          await refreshAccounts();
        })
      }
      onSubmitError={(error) => {
        setFailure(errorMessageOf(error, ADMIN_PROFILE.contactAvailable));
      }}
      className="flex flex-col gap-4"
    >
      {failure === undefined ? null : (
        <FormMessage role="alert">{failure}</FormMessage>
      )}
      <FormField
        control={form.control}
        name="nickname"
        label={NICKNAME_LABEL}
        description={NICKNAME_DESCRIPTION}
      >
        {(control) => <Input {...control} autoComplete="off" aria-required />}
      </FormField>
      <FormField
        control={form.control}
        name="title"
        label={ADMIN_TITLE_LABEL}
        description={ADMIN_TITLE_DESCRIPTION}
      >
        {(control) => <Input {...control} autoComplete="off" />}
      </FormField>
      <FormField
        control={form.control}
        name="avatarFileId"
        label={AVATAR_LABEL}
        description={AVATAR_DESCRIPTION}
      >
        {(control) => (
          <AdminAvatarField
            value={control.value}
            onChange={control.onChange}
            current={account.avatar}
            nickname={account.nickname ?? account.email}
            fieldRef={control.ref}
            aria-labelledby={control.labelId}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
          />
        )}
      </FormField>
      <AdminFormDialogFooter
        submitLabel={PROFILE_SUBMIT_LABEL}
        pending={pending}
        onCancel={cancel}
        audited={false}
      />
    </AppForm>
  );
}

export function AdminProfileDialog({
  open,
  onOpenChange,
  account,
}: AdminProfileDialogProps) {
  return (
    <AdminFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editProfileTitle(
        account === undefined ? '' : adminAccountLabelOf(account),
      )}
    >
      {account === undefined ? null : <AdminProfileForm account={account} />}
    </AdminFormDialog>
  );
}
