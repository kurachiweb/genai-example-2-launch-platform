import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import {
  AppForm,
  type SubmitErrorContext,
} from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { InquirerAvatar } from '../../../lib/components/inquiry/inquirer-avatar.tsx';
import { Textarea } from '../../../lib/components/ui/textarea/textarea.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { SERVER_FIELD_ERROR_TYPE } from '../../../lib/utilities/forms/server-field-errors.ts';
import { documentIdOf } from '../../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientMyInquiriesDocument,
  ClientSubmitMemberInquiryDocument,
} from '../../graphql/generated/graphql.ts';
import type {
  InquiryCategoryOption,
  InquiryComposerView,
} from '../../graphql/inquiry-contact.ts';
import { REQUIRED_SUFFIX } from '../auth/account-messages.ts';
import { INQUIRY_BOT_ACTIONS } from './bot-actions.ts';
import {
  INQUIRY_FILE_IDS_FIELD,
  inquiryAttachmentErrorsOf,
  NO_INVALID_FILE_IDS,
} from './inquiry-attachment-errors.ts';
import { InquiryAttachmentInput } from './inquiry-attachment-input.tsx';
import {
  ATTACHMENTS_DESCRIPTION,
  ATTACHMENTS_LABEL,
} from './inquiry-attachment-messages.ts';
import { InquiryCategorySelect } from './inquiry-category-select.tsx';
import {
  BODY_DESCRIPTION,
  BODY_LABEL,
  CATEGORY_LABEL,
  COMPOSER_LABEL,
  CONTACT_FORM_LABEL,
  SUBMIT_LABEL,
} from './inquiry-contact-messages.ts';
import {
  MEMBER_INQUIRY_FORM_SCHEMA,
  type MemberInquiryFormInput,
} from './inquiry-form-schemas.ts';
import {
  type InquirySubmitErrorView,
  inquirySubmitErrorOf,
} from './inquiry-submit-error.ts';
import { InquirySubmitErrorMessage } from './inquiry-submit-error-message.tsx';

export interface MemberInquiryFormProps {
  readonly categories: readonly InquiryCategoryOption[];
  readonly composer: InquiryComposerView;
}

const DEFAULT_VALUES: MemberInquiryFormInput = Object.freeze({
  categoryId: '',
  body: '',
  fileIds: [],
});

// 停止していないログイン中の利用者のフォーム。送信できたら、続きのやり取りをするチャットへ移る
export function MemberInquiryForm({
  categories,
  composer,
}: MemberInquiryFormProps) {
  const form = useAppForm(MEMBER_INQUIRY_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  const turnstile = useTurnstileToken();
  const queryClient = useQueryClient();
  // 送信の後はチャットへ移り一覧は表示しなくなるため、表示中の一覧を取得し直さずに古いものとだけして、戻った時に取得し直させる
  const submitInquiry = useMutation({
    ...graphqlMutationOptions(ClientSubmitMemberInquiryDocument),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [documentIdOf(ClientMyInquiriesDocument)],
        refetchType: 'none',
      }),
  });
  const navigate = useNavigate();
  const [invalidFileIds, setInvalidFileIds] =
    useState<ReadonlySet<string>>(NO_INVALID_FILE_IDS);
  const [submitError, setSubmitError] = useState<InquirySubmitErrorView>();

  // 添付できないファイルを一覧で示し、添付の欄のエラーにして取り除かせる
  const handleSubmitError = (
    error: unknown,
    { unmatched }: SubmitErrorContext,
  ): void => {
    const attachment = inquiryAttachmentErrorsOf(
      unmatched,
      form.getValues(INQUIRY_FILE_IDS_FIELD),
    );
    if (attachment.message !== undefined) {
      setInvalidFileIds(attachment.invalidFileIds);
      form.setError(
        INQUIRY_FILE_IDS_FIELD,
        { type: SERVER_FIELD_ERROR_TYPE, message: attachment.message },
        { shouldFocus: true },
      );
      if (attachment.others.length === 0) {
        return;
      }
    }
    setSubmitError(inquirySubmitErrorOf(error));
  };

  return (
    <AppForm
      form={form}
      aria-label={CONTACT_FORM_LABEL}
      serverFieldPrefix="input"
      onSubmit={async (input) => {
        setSubmitError(undefined);
        setInvalidFileIds(NO_INVALID_FILE_IDS);
        const { submitMemberInquiry } = await sendWithTurnstile(
          turnstile,
          (turnstileToken) =>
            submitInquiry.mutateAsync({ variables: { input }, turnstileToken }),
        );
        await navigate({
          to: '/inquiries/$inquiryId',
          params: { inquiryId: submitMemberInquiry.id },
        });
      }}
      onSubmitError={handleSubmitError}
      className="flex flex-col gap-5"
    >
      {submitError === undefined ? null : (
        <InquirySubmitErrorMessage error={submitError} />
      )}
      <div
        role="group"
        aria-label={COMPOSER_LABEL}
        className="flex items-center gap-3"
      >
        <InquirerAvatar
          image={composer.avatar}
          nickname={composer.nickname}
          size="xs"
        />
        <span className="font-bold break-all">{composer.nickname}</span>
      </div>
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
        name="body"
        label={`${BODY_LABEL}${REQUIRED_SUFFIX}`}
        description={BODY_DESCRIPTION}
      >
        {(control) => (
          <Textarea {...control} rows={8} className="min-h-40" aria-required />
        )}
      </FormField>
      <FormField
        control={form.control}
        name="fileIds"
        label={ATTACHMENTS_LABEL}
        description={ATTACHMENTS_DESCRIPTION}
      >
        {(control) => (
          <InquiryAttachmentInput
            ref={control.ref}
            value={control.value}
            onChange={control.onChange}
            invalidFileIds={invalidFileIds}
            aria-labelledby={control.labelId}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
          />
        )}
      </FormField>
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={INQUIRY_BOT_ACTIONS.member}
      />
      <SubmitButton className="self-start">{SUBMIT_LABEL}</SubmitButton>
    </AppForm>
  );
}
