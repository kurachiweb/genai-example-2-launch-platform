import { ScrollTextIcon } from 'lucide-react';
import { type RefObject, useRef, useState } from 'react';
import { useWatch } from 'react-hook-form';

import { INQUIRY_MESSAGE_MAX } from '../../../../common-lib/reporting/report-case-rules.ts';
import type { ReportTargetKind } from '../../../../common-lib/reporting/report-rules.ts';
import { trimWhiteSpace } from '../../../../common-lib/text/white-space.ts';
import { ReasonField } from '../../../../lib/components/admin/reason-field.tsx';
import { AppForm } from '../../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../../lib/components/form/use-app-form.ts';
import { MarkdownLengthCounter } from '../../../../lib/components/markdown-editor/markdown-length-counter.tsx';
import { Button } from '../../../../lib/components/ui/button/button.tsx';
import { Dialog } from '../../../../lib/components/ui/dialog/dialog.tsx';
import { DialogContent } from '../../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../../../../lib/components/ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../../lib/components/ui/dialog/dialog-title.tsx';
import { Textarea } from '../../../../lib/components/ui/textarea/textarea.tsx';
import { errorMessageOf } from '../../../../lib/utilities/graphql/graphql-result.ts';
import {
  AUDITED_ACTION_NOTICE,
  CONFIRM_ACTION_CANCEL_LABEL,
} from '../../../../lib/utilities/messages/admin-console-messages.ts';
import { ADMIN_PROFILE } from '../../../composition/app-profile.ts';
import { useReportCaseMutation } from '../shared/use-report-case-mutation.ts';
import {
  INFRINGEMENT_INQUIRY_FORM_SCHEMA,
  type InfringementInquiryFormInput,
  type InfringementInquiryFormOutput,
} from './infringement-inquiry-form-schema.ts';
import { INFRINGEMENT_INQUIRY_DIALOG_COPY } from './report-case-messages.ts';
import { useDeferredReportCaseRefresh } from '../shared/use-deferred-report-case-refresh.ts';

export interface InfringementInquiryDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly caseId: string;
  readonly targetKind: ReportTargetKind;
  // 閉じた後のフォーカスの戻り先(開いたボタン)
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  // 取り直す失敗の後の戻り先。取り直しで案件が対応中でなくなると開いたボタンが消えるため、区画の見出しへ移す
  readonly fallbackFocusRef: RefObject<HTMLElement | null>;
}

const DEFAULT_VALUES: InfringementInquiryFormInput = Object.freeze({
  message: '',
  reason: '',
});

interface InquiryFormProps {
  readonly pending: boolean;
  readonly onSubmit: (values: InfringementInquiryFormOutput) => Promise<void>;
  readonly onCancel: () => void;
}

function MessageCounter() {
  const message = useWatch<InfringementInquiryFormInput, 'message'>({
    name: 'message',
  });
  return (
    <MarkdownLengthCounter
      value={trimWhiteSpace(message)}
      max={INQUIRY_MESSAGE_MAX}
      className="self-end"
    />
  );
}

// ダイアログを閉じると中身が取り除かれるため、開くたびに入力と失敗の表示を始め直す
function InquiryForm({ pending, onSubmit, onCancel }: InquiryFormProps) {
  const form = useAppForm<
    InfringementInquiryFormInput,
    InfringementInquiryFormOutput
  >(INFRINGEMENT_INQUIRY_FORM_SCHEMA, { defaultValues: DEFAULT_VALUES });
  const [submitError, setSubmitError] = useState<string>();

  return (
    <AppForm
      form={form}
      onSubmit={async (values) => {
        setSubmitError(undefined);
        await onSubmit(values);
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
        name="message"
        label={INFRINGEMENT_INQUIRY_DIALOG_COPY.messageLabel}
        description={INFRINGEMENT_INQUIRY_DIALOG_COPY.messageNotice}
      >
        {(control) => (
          <>
            <Textarea
              {...control}
              rows={6}
              className="max-h-80 min-h-32"
              aria-required
            />
            <MessageCounter />
          </>
        )}
      </FormField>
      <ReasonField control={form.control} name="reason" required={false} />
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <ScrollTextIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{AUDITED_ACTION_NOTICE}</span>
      </p>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          aria-disabled={pending ? true : undefined}
          onClick={onCancel}
        >
          {CONFIRM_ACTION_CANCEL_LABEL}
        </Button>
        <SubmitButton>{INFRINGEMENT_INQUIRY_DIALOG_COPY.confirm}</SubmitButton>
      </DialogFooter>
    </AppForm>
  );
}

// 投稿者へ権利侵害の照会を送る。独自の入力のダイアログのため確認のダイアログと同じく、処理中は閉じさせず、失敗はダイアログの中に示して入力を保つ
export function InfringementInquiryDialog({
  open,
  onOpenChange,
  caseId,
  targetKind,
  returnFocusRef,
  fallbackFocusRef,
}: InfringementInquiryDialogProps) {
  const { run, refreshAfter } = useReportCaseMutation('send-inquiry', {
    targetKind,
    deferRefresh: true,
  });
  const deferred = useDeferredReportCaseRefresh(refreshAfter);
  const [pending, setPending] = useState(false);
  // 処理中の状態は再描画の後に効くため、同じ描画の間に届いた閉じる操作もここで止める
  const pendingRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const refreshDeferredRef = useRef(false);

  const close = (): void => {
    if (pendingRef.current) {
      return;
    }
    deferred.flush();
    onOpenChange(false);
  };

  const submit = async ({
    message,
    reason,
  }: InfringementInquiryFormOutput): Promise<void> => {
    pendingRef.current = true;
    setPending(true);
    try {
      await run({ caseId, message, reason });
    } catch (error) {
      if (deferred.defer(error)) {
        refreshDeferredRef.current = true;
      }
      throw error;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
    >
      <DialogContent
        ref={contentRef}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        closeButtonDisabled={pending}
        onBlur={(event) => {
          // 処理中に受け付けなかったダイアログの外の押下は、フォーカスを<body>へ落として戻さないため、ダイアログへ戻す
          if (
            pendingRef.current &&
            event.relatedTarget === null &&
            document.activeElement === document.body
          ) {
            contentRef.current?.focus();
          }
        }}
        onOpenAutoFocus={() => {
          refreshDeferredRef.current = false;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = refreshDeferredRef.current
            ? fallbackFocusRef.current
            : returnFocusRef.current;
          if (target?.isConnected === true) {
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{INFRINGEMENT_INQUIRY_DIALOG_COPY.title}</DialogTitle>
          <DialogDescription>
            {INFRINGEMENT_INQUIRY_DIALOG_COPY.description}
          </DialogDescription>
        </DialogHeader>
        <InquiryForm pending={pending} onSubmit={submit} onCancel={close} />
      </DialogContent>
    </Dialog>
  );
}
