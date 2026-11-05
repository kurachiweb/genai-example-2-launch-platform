import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { Textarea } from '../../../lib/components/ui/textarea/textarea.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { ClientSubmitGuestInquiryDocument } from '../../graphql/generated/graphql.ts';
import type { InquiryCategoryOption } from '../../graphql/inquiry-contact.ts';
import { REQUIRED_SUFFIX } from '../auth/account-messages.ts';
import { INQUIRY_BOT_ACTIONS } from './bot-actions.ts';
import { GuestInquiryComplete } from './guest-inquiry-complete.tsx';
import { InquiryCategorySelect } from './inquiry-category-select.tsx';
import {
  BODY_DESCRIPTION,
  BODY_LABEL,
  CATEGORY_LABEL,
  CONTACT_EMAIL_DESCRIPTION,
  CONTACT_EMAIL_LABEL,
  CONTACT_FORM_LABEL,
  NICKNAME_DESCRIPTION,
  NICKNAME_LABEL,
  SUBMIT_LABEL,
} from './inquiry-contact-messages.ts';
import {
  GUEST_INQUIRY_FORM_SCHEMA,
  type GuestInquiryFormInput,
} from './inquiry-form-schemas.ts';
import {
  type InquirySubmitErrorView,
  inquirySubmitErrorOf,
} from './inquiry-submit-error.ts';
import { InquirySubmitErrorMessage } from './inquiry-submit-error-message.tsx';

export interface GuestInquiryFormProps {
  readonly categories: readonly InquiryCategoryOption[];
}

const DEFAULT_VALUES: GuestInquiryFormInput = Object.freeze({
  categoryId: '',
  nickname: '',
  email: '',
  body: '',
});

// 未ログインと停止中の利用者のフォーム。システム上で返信しないため、送信できたらフォームを受付の表示に置き換える
export function GuestInquiryForm({ categories }: GuestInquiryFormProps) {
  const form = useAppForm(GUEST_INQUIRY_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  const turnstile = useTurnstileToken();
  const submitInquiry = useMutation(
    graphqlMutationOptions(ClientSubmitGuestInquiryDocument),
  );
  const [submitError, setSubmitError] = useState<InquirySubmitErrorView>();
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return <GuestInquiryComplete />;
  }

  return (
    <AppForm
      form={form}
      aria-label={CONTACT_FORM_LABEL}
      serverFieldPrefix="input"
      onSubmit={async (input) => {
        setSubmitError(undefined);
        await sendWithTurnstile(turnstile, (turnstileToken) =>
          submitInquiry.mutateAsync({ variables: { input }, turnstileToken }),
        );
        setSubmitted(true);
      }}
      onSubmitError={(error) => {
        setSubmitError(inquirySubmitErrorOf(error));
      }}
      className="flex flex-col gap-5"
    >
      {submitError === undefined ? null : (
        <InquirySubmitErrorMessage error={submitError} />
      )}
      <FormField
        control={form.control}
        name="categoryId"
        label={`${CATEGORY_LABEL}${REQUIRED_SUFFIX}`}
      >
        {(control) => (
          <InquiryCategorySelect
            {...control}
            categories={categories}
            aria-required
          />
        )}
      </FormField>
      <FormField
        control={form.control}
        name="nickname"
        label={`${NICKNAME_LABEL}${REQUIRED_SUFFIX}`}
        description={NICKNAME_DESCRIPTION}
      >
        {(control) => (
          <Input {...control} autoComplete="nickname" aria-required />
        )}
      </FormField>
      <FormField
        control={form.control}
        name="email"
        label={`${CONTACT_EMAIL_LABEL}${REQUIRED_SUFFIX}`}
        description={CONTACT_EMAIL_DESCRIPTION}
      >
        {(control) => (
          <Input {...control} type="email" autoComplete="email" aria-required />
        )}
      </FormField>
      <FormField
        control={form.control}
        name="body"
        label={`${BODY_LABEL}${REQUIRED_SUFFIX}`}
        description={BODY_DESCRIPTION}
      >
        {(control) => (
          <Textarea {...control} rows={8} className="min-h-40" aria-required />
        )}
      </FormField>
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={INQUIRY_BOT_ACTIONS.guest}
      />
      <SubmitButton className="self-start">{SUBMIT_LABEL}</SubmitButton>
    </AppForm>
  );
}
