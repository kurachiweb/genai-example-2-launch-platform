import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { ReasonField } from '../../../lib/components/admin/reason-field.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import { AdminInviteDocument } from '../../graphql/generated/graphql.ts';
import { EMAIL_LABEL, REQUIRED_SUFFIX } from '../auth/admin-auth-messages.ts';
import {
  INVITE_ADMIN_FORM_SCHEMA,
  type InviteAdminFormInput,
} from './admin-account-form-schemas.ts';
import {
  INVITE_ADMIN_DESCRIPTION,
  INVITE_ADMIN_LABEL,
  INVITE_ADMIN_SUBMIT_LABEL,
  invitationSentMessage,
} from './admin-accounts-messages.ts';
import { AdminFormDialog } from './admin-form-dialog.tsx';
import { useAdminFormDialogControls } from './admin-form-dialog-controls.ts';
import { AdminFormDialogFooter } from './admin-form-dialog-footer.tsx';
import { useAdminAccountsRefresh } from './use-admin-accounts-refresh.ts';

export interface InviteAdminDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const DEFAULT_VALUES: InviteAdminFormInput = Object.freeze({
  email: '',
  reason: '',
});

// ダイアログを閉じると中身が取り除かれるため、開くたびに入力と失敗の表示を始め直す
function InviteAdminForm() {
  const { pending, run, cancel } = useAdminFormDialogControls();
  const form = useAppForm(INVITE_ADMIN_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  const invite = useMutation(graphqlMutationOptions(AdminInviteDocument));
  const refreshAccounts = useAdminAccountsRefresh();
  const [failure, setFailure] = useState<string>();

  return (
    <AppForm
      form={form}
      onSubmit={({ email, reason }) =>
        run(async () => {
          setFailure(undefined);
          await invite.mutateAsync({ variables: { email, reason } });
          notify.success(invitationSentMessage(email));
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
        name="email"
        label={`${EMAIL_LABEL}${REQUIRED_SUFFIX}`}
      >
        {(control) => (
          <Input
            {...control}
            type="email"
            autoComplete="off"
            translate="no"
            aria-required
          />
        )}
      </FormField>
      <ReasonField control={form.control} name="reason" required={false} />
      <AdminFormDialogFooter
        submitLabel={INVITE_ADMIN_SUBMIT_LABEL}
        pending={pending}
        onCancel={cancel}
        audited
      />
    </AppForm>
  );
}

export function InviteAdminDialog({
  open,
  onOpenChange,
}: InviteAdminDialogProps) {
  return (
    <AdminFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={INVITE_ADMIN_LABEL}
      description={INVITE_ADMIN_DESCRIPTION}
    >
      <InviteAdminForm />
    </AdminFormDialog>
  );
}
