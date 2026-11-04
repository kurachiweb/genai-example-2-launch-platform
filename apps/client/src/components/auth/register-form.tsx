import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { PasswordInput } from '../../../lib/components/auth/password-input.tsx';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Checkbox } from '../../../lib/components/ui/checkbox/checkbox.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientRegisterUserDocument } from '../../graphql/generated/graphql.ts';
import { PRIVACY_HREF, TERMS_HREF } from '../layout/site-links.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import {
  EMAIL_LABEL,
  HAS_ACCOUNT_PROMPT,
  LINK_ACTION_SUFFIX,
  LOGIN_LABEL,
  NEW_PASSWORD_DESCRIPTION,
  NICKNAME_LABEL,
  PASSWORD_LABEL,
  PRIVACY_LINK_LABEL,
  REGISTER_PAGE_TITLE,
  REGISTER_SUBMIT_LABEL,
  REQUIRED_SUFFIX,
  TERMS_AGREEMENT_CONNECTOR,
  TERMS_AGREEMENT_STATEMENT,
  TERMS_LINK_LABEL,
} from './account-messages.ts';
import {
  REGISTER_FORM_SCHEMA,
  type RegisterFormInput,
} from './account-form-schemas.ts';
import { BOT_ACTIONS } from './bot-actions.ts';
import { INLINE_LINK_CLASS_NAME } from './inline-link-class.ts';
import { HOME_PATH } from '../../../lib/utilities/auth/return-path.ts';
import { useSignedInNavigation } from './use-signed-in-navigation.ts';

const DEFAULT_VALUES: RegisterFormInput = Object.freeze({
  nickname: '',
  email: '',
  password: '',
  agreedToTerms: false,
});

// FormFieldはラベルを入力欄の上に置くため、同意の欄だけはチェックボックスを左、ラベルを右に並べ、エラーを2列にまたがせる
const AGREEMENT_FIELD_CLASS_NAME =
  'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 *:data-[slot=form-message]:col-span-2 *:data-[slot=label]:col-start-2 *:data-[slot=label]:row-start-1 *:data-[slot=label]:leading-normal';

export function RegisterForm() {
  const form = useAppForm(REGISTER_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  const turnstile = useTurnstileToken();
  const registerUser = useMutation(
    graphqlMutationOptions(ClientRegisterUserDocument),
  );
  const enterSignedIn = useSignedInNavigation();
  const [submitError, setSubmitError] = useState<string>();

  return (
    <>
      <AppForm
        form={form}
        aria-label={REGISTER_PAGE_TITLE}
        serverFieldPrefix="input"
        onSubmit={async (input) => {
          setSubmitError(undefined);
          await sendWithTurnstile(turnstile, (turnstileToken) =>
            registerUser.mutateAsync({ variables: { input }, turnstileToken }),
          );
          await enterSignedIn(HOME_PATH);
        }}
        onSubmitError={(error) => {
          setSubmitError(
            errorMessageOf(error, CLIENT_PROFILE.contactAvailable),
          );
        }}
        className="flex flex-col gap-5"
      >
        {submitError === undefined ? null : (
          <FormMessage role="alert">{submitError}</FormMessage>
        )}
        <FormField
          control={form.control}
          name="nickname"
          label={`${NICKNAME_LABEL}${REQUIRED_SUFFIX}`}
        >
          {(control) => (
            <Input {...control} autoComplete="nickname" aria-required />
          )}
        </FormField>
        <FormField
          control={form.control}
          name="email"
          label={`${EMAIL_LABEL}${REQUIRED_SUFFIX}`}
        >
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="email"
              aria-required
            />
          )}
        </FormField>
        <FormField
          control={form.control}
          name="password"
          label={`${PASSWORD_LABEL}${REQUIRED_SUFFIX}`}
          description={NEW_PASSWORD_DESCRIPTION}
        >
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="new-password"
              aria-required
            />
          )}
        </FormField>
        <FormField
          control={form.control}
          name="agreedToTerms"
          className={AGREEMENT_FIELD_CLASS_NAME}
          label={
            <span>
              <PathLink href={TERMS_HREF} className={INLINE_LINK_CLASS_NAME}>
                {TERMS_LINK_LABEL}
              </PathLink>
              {TERMS_AGREEMENT_CONNECTOR}
              <PathLink href={PRIVACY_HREF} className={INLINE_LINK_CLASS_NAME}>
                {PRIVACY_LINK_LABEL}
              </PathLink>
              {TERMS_AGREEMENT_STATEMENT}
              {REQUIRED_SUFFIX}
            </span>
          }
        >
          {({ value, onChange, ...control }) => (
            <Checkbox
              {...control}
              checked={value}
              onCheckedChange={(checked) => {
                onChange(checked === true);
              }}
              aria-required
              className="mt-0.5"
            />
          )}
        </FormField>
        <TurnstileWidget
          {...turnstile.widgetProps}
          action={BOT_ACTIONS.register}
        />
        <SubmitButton className="self-start">
          {REGISTER_SUBMIT_LABEL}
        </SubmitButton>
      </AppForm>
      <p className="text-sm">
        {HAS_ACCOUNT_PROMPT}
        <Link to="/auth/login" className={INLINE_LINK_CLASS_NAME}>
          {LOGIN_LABEL}
        </Link>
        {LINK_ACTION_SUFFIX}
      </p>
    </>
  );
}
