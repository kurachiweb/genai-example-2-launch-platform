import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { ClientRequestEmailChangeDocument } from '../../graphql/generated/graphql.ts';
import {
  EMAIL_CHANGE_FORM_SCHEMAS,
  type EmailChangeFormInput,
} from '../auth/account-form-schemas.ts';
import {
  EMAIL_CHANGE_PAGE_TITLE,
  REQUIRED_SUFFIX,
} from '../auth/account-messages.ts';
import { BOT_ACTIONS } from '../auth/bot-actions.ts';
import { ResultNotice } from '../../../lib/components/feedback/result-notice.tsx';
import {
  type ReauthenticationFieldNames,
  ReauthenticationFields,
} from './reauthentication-fields.tsx';
import { SettingsSection } from './settings-section.tsx';
import {
  EMAIL_CHANGE_REQUESTED_MESSAGE,
  EMAIL_CHANGE_SECTION_DESCRIPTION,
  EMAIL_CHANGE_SUBMIT_LABEL,
  NEW_EMAIL_LABEL,
} from './settings-messages.ts';
import { useReauthenticationMode } from './use-reauthentication-mode.ts';
import { useReauthenticationSubmitError } from './use-reauthentication-submit-error.ts';

export interface EmailChangeSectionProps {
  readonly totpEnabled: boolean;
  readonly disabled: boolean;
}

const DEFAULT_VALUES: EmailChangeFormInput = Object.freeze({
  newEmail: '',
  reAuthentication: {
    currentPassword: '',
    secondFactor: { totpCode: '', recoveryCode: '' },
  },
});

const FIELD_NAMES: ReauthenticationFieldNames<EmailChangeFormInput> =
  Object.freeze({
    current: 'reAuthentication.currentPassword',
    totpCode: 'reAuthentication.secondFactor.totpCode',
    recoveryCode: 'reAuthentication.secondFactor.recoveryCode',
  });

export function EmailChangeSection({
  totpEnabled,
  disabled,
}: EmailChangeSectionProps) {
  const { mode, toggleSecondFactor } = useReauthenticationMode(totpEnabled);
  const form = useAppForm(EMAIL_CHANGE_FORM_SCHEMAS[mode], {
    defaultValues: DEFAULT_VALUES,
  });
  const turnstile = useTurnstileToken();
  const requestChange = useMutation(
    graphqlMutationOptions(ClientRequestEmailChangeDocument),
  );
  const { submitError, clearSubmitError, onSubmitError } =
    useReauthenticationSubmitError();
  const [sentCount, setSentCount] = useState(0);
  const { reset } = form;

  // 送信の処理の中で値を戻すと送信の完了の状態の更新と重なるため、送信できた後に戻す
  useEffect(() => {
    if (sentCount > 0) {
      reset(DEFAULT_VALUES);
    }
  }, [sentCount, reset]);

  return (
    <SettingsSection
      title={EMAIL_CHANGE_PAGE_TITLE}
      description={<p>{EMAIL_CHANGE_SECTION_DESCRIPTION}</p>}
    >
      {sentCount === 0 ? null : (
        <ResultNotice
          key={sentCount}
          tone="success"
          message={EMAIL_CHANGE_REQUESTED_MESSAGE}
        />
      )}
      <AppForm
        form={form}
        aria-label={EMAIL_CHANGE_PAGE_TITLE}
        serverFieldPrefix="input"
        onSubmit={async (input) => {
          clearSubmitError();
          await sendWithTurnstile(turnstile, (turnstileToken) =>
            requestChange.mutateAsync({ variables: { input }, turnstileToken }),
          );
          setSentCount((count) => count + 1);
        }}
        onSubmitError={onSubmitError}
        className="flex flex-col gap-5"
      >
        {submitError === undefined ? null : (
          <FormMessage role="alert">{submitError}</FormMessage>
        )}
        <FormField
          control={form.control}
          name="newEmail"
          label={`${NEW_EMAIL_LABEL}${REQUIRED_SUFFIX}`}
          disabled={disabled}
        >
          {(field) => (
            <Input {...field} type="email" autoComplete="email" aria-required />
          )}
        </FormField>
        <ReauthenticationFields
          control={form.control}
          names={FIELD_NAMES}
          mode={mode}
          onToggleSecondFactor={toggleSecondFactor}
          disabled={disabled}
        />
        {disabled ? null : (
          <TurnstileWidget
            {...turnstile.widgetProps}
            action={BOT_ACTIONS.emailChange}
          />
        )}
        <SubmitButton className="self-start" disabled={disabled}>
          {EMAIL_CHANGE_SUBMIT_LABEL}
        </SubmitButton>
      </AppForm>
    </SettingsSection>
  );
}
