import { useMutation } from '@tanstack/react-query';
import { type RefObject, useId, useState } from 'react';

import {
  ADMIN_ROLE_LABELS,
  ADMIN_ROLES,
  type AdminRole,
} from '../../../common-lib/admin/admin-roles.ts';
import { ReasonField } from '../../../lib/components/admin/reason-field.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { RadioGroup } from '../../../lib/components/ui/radio-group/radio-group.tsx';
import { RadioGroupItem } from '../../../lib/components/ui/radio-group/radio-group-item.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import type { AdminAccount } from '../../graphql/admin-accounts.ts';
import { toGraphQLAdminRole } from '../../graphql/admin-role.ts';
import { AdminChangeRoleDocument } from '../../graphql/generated/graphql.ts';
import { useAdminViewerRefresh } from '../auth/use-admin-viewer-refresh.ts';
import { useCurrentAdmin } from '../layout/use-current-admin.ts';
import {
  CHANGE_ROLE_FORM_SCHEMA,
  type ChangeRoleFormInput,
} from './admin-account-form-schemas.ts';
import {
  CHANGE_ROLE_SUBMIT_LABEL,
  changeRoleTitle,
  currentRoleText,
  NEW_ROLE_LABEL,
  ROLE_CHANGED_MESSAGE,
} from './admin-accounts-messages.ts';
import { adminAccountLabelOf } from './admin-account-label.ts';
import { AdminFormDialog } from './admin-form-dialog.tsx';
import { useAdminFormDialogControls } from './admin-form-dialog-controls.ts';
import { AdminFormDialogFooter } from './admin-form-dialog-footer.tsx';
import { useAdminAccountsRefresh } from './use-admin-accounts-refresh.ts';

export interface ChangeRoleDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  // 閉じる動きの間も題名を保つため、閉じても対象を残す
  readonly account: AdminAccount | undefined;
  // 変更の成功を、閉じる前に呼ぶ。開いた元の操作が変更後のロールで消えるかを呼び出す側が判定し、returnFocusRefの移り先を決める
  readonly onChanged: (account: AdminAccount, role: AdminRole) => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

// 現在のロールへの変更は監査ログに意味の無い記録を残すため、未選択から始めて現在のロールを選べなくする
const DEFAULT_VALUES: ChangeRoleFormInput = Object.freeze({
  role: '',
  reason: '',
});

interface ChangeRoleFormProps {
  readonly account: AdminAccount;
  readonly onChanged: (account: AdminAccount, role: AdminRole) => void;
}

function ChangeRoleForm({ account, onChanged }: ChangeRoleFormProps) {
  const { pending, run, cancel } = useAdminFormDialogControls();
  const form = useAppForm(CHANGE_ROLE_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  const changeRole = useMutation(
    graphqlMutationOptions(AdminChangeRoleDocument),
  );
  const viewer = useCurrentAdmin();
  const refreshAccounts = useAdminAccountsRefresh();
  const refreshViewer = useAdminViewerRefresh();
  const [failure, setFailure] = useState<string>();
  const itemBaseId = useId();
  const itemIdOf = (role: AdminRole): string => `${itemBaseId}-${role}`;

  return (
    <AppForm
      form={form}
      onSubmit={({ role, reason }) =>
        run(async () => {
          setFailure(undefined);
          await changeRole.mutateAsync({
            variables: {
              id: account.id,
              role: toGraphQLAdminRole(role),
              reason,
            },
          });
          onChanged(account, role);
          notify.success(ROLE_CHANGED_MESSAGE);
          await refreshAccounts();
          // 自分のロールは区画と操作の出し分けが読むログイン中の管理者にも入っているため、取り直させる
          if (account.id === viewer.id) {
            await refreshViewer();
          }
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
      <p className="text-sm">
        {currentRoleText(ADMIN_ROLE_LABELS[account.role])}
      </p>
      <FormField control={form.control} name="role" label={NEW_ROLE_LABEL}>
        {(control) => (
          <RadioGroup
            id={control.id}
            ref={control.ref}
            value={control.value}
            onValueChange={control.onChange}
            onBlur={control.onBlur}
            disabled={control.disabled}
            aria-labelledby={control.labelId}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            aria-required
          >
            {ADMIN_ROLES.map((role) => (
              <div key={role} className="flex items-center gap-2">
                <RadioGroupItem
                  id={itemIdOf(role)}
                  value={role}
                  disabled={role === account.role}
                />
                <Label htmlFor={itemIdOf(role)}>
                  {ADMIN_ROLE_LABELS[role]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
      </FormField>
      <ReasonField control={form.control} name="reason" required={false} />
      <AdminFormDialogFooter
        submitLabel={CHANGE_ROLE_SUBMIT_LABEL}
        pending={pending}
        onCancel={cancel}
        audited
      />
    </AppForm>
  );
}

export function ChangeRoleDialog({
  open,
  onOpenChange,
  account,
  onChanged,
  returnFocusRef,
}: ChangeRoleDialogProps) {
  return (
    <AdminFormDialog
      open={open}
      onOpenChange={onOpenChange}
      {...(returnFocusRef === undefined ? {} : { returnFocusRef })}
      title={changeRoleTitle(
        account === undefined ? '' : adminAccountLabelOf(account),
      )}
    >
      {account === undefined ? null : (
        <ChangeRoleForm account={account} onChanged={onChanged} />
      )}
    </AdminFormDialog>
  );
}
