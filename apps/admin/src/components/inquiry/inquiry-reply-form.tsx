import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ScrollTextIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { ReasonField } from '../../../lib/components/admin/reason-field.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Textarea } from '../../../lib/components/ui/textarea/textarea.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { AUDITED_ACTION_NOTICE } from '../../../lib/utilities/messages/admin-console-messages.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  adminInquiryQueryOptions,
  markInquirySummariesStale,
} from '../../graphql/admin-inquiries.ts';
import { AdminReplyToInquiryDocument } from '../../graphql/generated/graphql.ts';
import {
  REPLY_BODY_DESCRIPTION,
  REPLY_BODY_LABEL,
  REPLY_NOTIFICATION_FAILED_MESSAGE,
  REPLY_SECTION_TITLE,
  REPLY_SENT_MESSAGE,
  REPLY_SUBMIT_LABEL,
} from './inquiry-operations-messages.ts';
import {
  INQUIRY_REPLY_FORM_SCHEMA,
  type InquiryReplyFormInput,
} from './inquiry-reply-form-schema.ts';

export interface InquiryReplyFormProps {
  readonly inquiryId: string;
}

interface ReplyFieldsProps {
  readonly inquiryId: string;
  readonly labelledById: string;
  readonly focusOnMount: boolean;
  readonly onSent: () => void;
}

const DEFAULT_VALUES: InquiryReplyFormInput = Object.freeze({
  body: '',
  reason: '',
});

function ReplyFields({
  inquiryId,
  labelledById,
  focusOnMount,
  onSent,
}: ReplyFieldsProps) {
  const form = useAppForm(INQUIRY_REPLY_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  const queryClient = useQueryClient();
  const reply = useMutation(
    graphqlMutationOptions(AdminReplyToInquiryDocument),
  );
  const [submitError, setSubmitError] = useState<string>();
  const { setFocus } = form;

  // 送信の後に作り直した欄は空で送信のボタンが無効になり、押したボタンのフォーカスが<body>へ落ちるため、続けて入力する本文の欄へ移す
  useEffect(() => {
    if (focusOnMount) {
      setFocus('body');
    }
  }, [focusOnMount, setFocus]);

  return (
    <AppForm
      form={form}
      aria-labelledby={labelledById}
      onSubmit={async ({ body, reason }) => {
        setSubmitError(undefined);
        const { replyToInquiry } = await reply.mutateAsync({
          variables: { inquiryId, body, reason },
        });
        // 返信は保存済みのため、通知メールの失敗を送信の失敗として扱わない。送り直すと同じ返信が二重に保存される
        if (replyToInquiry.notificationQueued) {
          notify.success(REPLY_SENT_MESSAGE);
        } else {
          notify.warning(REPLY_NOTIFICATION_FAILED_MESSAGE);
        }
        // 送った返信を示すまで送信中のままにするため、表示中の詳細の取り直しを待つ
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: adminInquiryQueryOptions(inquiryId).queryKey,
          }),
          markInquirySummariesStale(queryClient),
        ]);
        onSent();
      }}
      onSubmitError={(error) => {
        setSubmitError(errorMessageOf(error, ADMIN_PROFILE.contactAvailable));
      }}
      className="flex flex-col gap-4"
    >
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <FormField
        control={form.control}
        name="body"
        label={REPLY_BODY_LABEL}
        description={REPLY_BODY_DESCRIPTION}
      >
        {(control) => (
          <Textarea {...control} rows={4} className="min-h-28" aria-required />
        )}
      </FormField>
      <ReasonField control={form.control} name="reason" required={false} />
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <ScrollTextIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{AUDITED_ACTION_NOTICE}</span>
      </p>
      <SubmitButton className="self-start">{REPLY_SUBMIT_LABEL}</SubmitButton>
    </AppForm>
  );
}

// 送信できたら本文と理由をまとめて空にするため、フォームごと作り直す
export function InquiryReplyForm({ inquiryId }: InquiryReplyFormProps) {
  const headingId = useId();
  const [sentCount, setSentCount] = useState(0);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-lg font-semibold">
        {REPLY_SECTION_TITLE}
      </h2>
      <ReplyFields
        key={sentCount}
        inquiryId={inquiryId}
        labelledById={headingId}
        focusOnMount={sentCount > 0}
        onSent={() => {
          setSentCount((count) => count + 1);
        }}
      />
    </section>
  );
}
