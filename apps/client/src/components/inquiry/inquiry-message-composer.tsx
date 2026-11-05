import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  AppForm,
  type SubmitErrorContext,
} from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Textarea } from '../../../lib/components/ui/textarea/textarea.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { SERVER_FIELD_ERROR_TYPE } from '../../../lib/utilities/forms/server-field-errors.ts';
import { documentIdOf } from '../../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientMemberInquiryDocument,
  ClientMyInquiriesDocument,
  ClientPostInquiryMessageDocument,
} from '../../graphql/generated/graphql.ts';
import { REQUIRED_SUFFIX } from '../auth/account-messages.ts';
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
import {
  INQUIRY_MESSAGE_DESCRIPTION,
  INQUIRY_MESSAGE_FORM_LABEL,
} from './inquiry-chat-messages.ts';
import { BODY_LABEL, SUBMIT_LABEL } from './inquiry-contact-messages.ts';
import {
  INQUIRY_MESSAGE_FORM_SCHEMA,
  type InquiryMessageFormInput,
} from './inquiry-form-schemas.ts';
import {
  type InquirySubmitErrorView,
  inquirySubmitErrorOf,
} from './inquiry-submit-error.ts';
import { InquirySubmitErrorMessage } from './inquiry-submit-error-message.tsx';

export interface InquiryMessageComposerProps {
  readonly inquiryId: string;
}

interface InquiryMessageFormProps {
  readonly inquiryId: string;
  readonly focusOnMount: boolean;
  readonly onSent: () => void;
}

const DEFAULT_VALUES: InquiryMessageFormInput = Object.freeze({
  body: '',
  fileIds: [],
});

function InquiryMessageForm({
  inquiryId,
  focusOnMount,
  onSent,
}: InquiryMessageFormProps) {
  const form = useAppForm(INQUIRY_MESSAGE_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  const queryClient = useQueryClient();
  // 送ったメッセージを示すまで送信中のままにするため、表示中のチャットの取り直しを待つ。最後のメッセージの日時が変わる自分の問い合わせの一覧は表示していないため、古いものとだけして戻った時に取得し直させる
  const postMessage = useMutation({
    ...graphqlMutationOptions(ClientPostInquiryMessageDocument),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: [documentIdOf(ClientMemberInquiryDocument)],
        }),
        queryClient.invalidateQueries({
          queryKey: [documentIdOf(ClientMyInquiriesDocument)],
          refetchType: 'none',
        }),
      ]),
  });
  const [invalidFileIds, setInvalidFileIds] =
    useState<ReadonlySet<string>>(NO_INVALID_FILE_IDS);
  const [submitError, setSubmitError] = useState<InquirySubmitErrorView>();
  const { setFocus } = form;

  // 送信の後に作り直した欄は空で送信のボタンが無効になり、押したボタンのフォーカスが<body>へ落ちるため、続けて入力する本文の欄へ移す
  useEffect(() => {
    if (focusOnMount) {
      setFocus('body');
    }
  }, [focusOnMount, setFocus]);

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
      aria-label={INQUIRY_MESSAGE_FORM_LABEL}
      serverFieldPrefix="input"
      onSubmit={async (input) => {
        setSubmitError(undefined);
        setInvalidFileIds(NO_INVALID_FILE_IDS);
        await postMessage.mutateAsync({ variables: { inquiryId, input } });
        onSent();
      }}
      onSubmitError={handleSubmitError}
      className="flex flex-col gap-5"
    >
      {submitError === undefined ? null : (
        <InquirySubmitErrorMessage error={submitError} />
      )}
      <FormField
        control={form.control}
        name="body"
        label={`${BODY_LABEL}${REQUIRED_SUFFIX}`}
        description={INQUIRY_MESSAGE_DESCRIPTION}
      >
        {(control) => (
          <Textarea {...control} rows={4} className="min-h-28" aria-required />
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
      <SubmitButton className="self-start">{SUBMIT_LABEL}</SubmitButton>
    </AppForm>
  );
}

// 送信できたら本文・添付の一覧・最新の選択の一覧をまとめて空にするため、フォームごと作り直す
export function InquiryMessageComposer({
  inquiryId,
}: InquiryMessageComposerProps) {
  const [sentCount, setSentCount] = useState(0);
  return (
    <InquiryMessageForm
      key={sentCount}
      inquiryId={inquiryId}
      focusOnMount={sentCount > 0}
      onSent={() => {
        setSentCount((count) => count + 1);
      }}
    />
  );
}
