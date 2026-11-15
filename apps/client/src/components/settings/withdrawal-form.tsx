import { useMutation } from '@tanstack/react-query';

import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { DialogClose } from '../../../lib/components/ui/dialog/dialog-close.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { ClientWithdrawDocument } from '../../graphql/generated/graphql.ts';
import {
  WITHDRAWAL_FORM_SCHEMAS,
  type WithdrawalFormInput,
} from '../auth/account-form-schemas.ts';
import { BOT_ACTIONS } from '../auth/bot-actions.ts';
import { useSignedInNavigation } from '../auth/use-signed-in-navigation.ts';
import {
  type ReauthenticationFieldNames,
  ReauthenticationFields,
} from './reauthentication-fields.tsx';
import {
  CANCEL_LABEL,
  WITHDRAWAL_ACTION_LABEL,
  WITHDRAWAL_SECTION_TITLE,
  WITHDRAWN_MESSAGE,
} from './settings-messages.ts';
import { useReauthenticationMode } from './use-reauthentication-mode.ts';
import { useReauthenticationSubmitError } from './use-reauthentication-submit-error.ts';

export interface WithdrawalFormProps {
  readonly totpEnabled: boolean;
}

const DEFAULT_VALUES: WithdrawalFormInput = Object.freeze({
  currentPassword: '',
  secondFactor: { totpCode: '', recoveryCode: '' },
});

const FIELD_NAMES: ReauthenticationFieldNames<WithdrawalFormInput> =
  Object.freeze({
    current: 'currentPassword',
    totpCode: 'secondFactor.totpCode',
    recoveryCode: 'secondFactor.recoveryCode',
  });

const HOME_PATH = '/';

export function WithdrawalForm({ totpEnabled }: WithdrawalFormProps) {
  const { mode, toggleSecondFactor } = useReauthenticationMode(totpEnabled);
  const form = useAppForm(WITHDRAWAL_FORM_SCHEMAS[mode], {
    defaultValues: DEFAULT_VALUES,
  });
  const turnstile = useTurnstileToken();
  const withdraw = useMutation(graphqlMutationOptions(ClientWithdrawDocument));
  const leaveSignedOut = useSignedInNavigation();
  const { submitError, clearSubmitError, onSubmitError } =
    useReauthenticationSubmitError();

  return (
    <AppForm
      form={form}
      aria-label={WITHDRAWAL_SECTION_TITLE}
      serverFieldPrefix="input"
      onSubmit={async (input) => {
        clearSubmitError();
        await sendWithTurnstile(turnstile, (turnstileToken) =>
          withdraw.mutateAsync({ variables: { input }, turnstileToken }),
        );
        notify.success(WITHDRAWN_MESSAGE);
        // 退会でセッションが消えたため、利用者の取得を無効にしてからログイン不要のトップページへ移る。退会した画面へ戻れないよう履歴を置き換える
        await leaveSignedOut(HOME_PATH);
      }}
      onSubmitError={onSubmitError}
      className="flex flex-col gap-5"
    >
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <ReauthenticationFields
        control={form.control}
        names={FIELD_NAMES}
        mode={mode}
        onToggleSecondFactor={toggleSecondFactor}
      />
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={BOT_ACTIONS.withdraw}
      />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {CANCEL_LABEL}
          </Button>
        </DialogClose>
        <SubmitButton variant="destructive">
          {WITHDRAWAL_ACTION_LABEL}
        </SubmitButton>
      </DialogFooter>
    </AppForm>
  );
}
