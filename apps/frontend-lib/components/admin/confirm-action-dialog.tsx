import { ScrollTextIcon } from 'lucide-react';
import { type RefObject, useRef, useState } from 'react';

import {
  AUDITED_ACTION_NOTICE,
  CONFIRM_ACTION_CANCEL_LABEL,
} from '../../utilities/messages/admin-console-messages.ts';
import { z } from '../../utilities/validation/zod.ts';
import { AppForm } from '../form/app-form.tsx';
import { FormMessage } from '../form/form-message.tsx';
import { SubmitButton } from '../form/submit-button.tsx';
import { useAppForm } from '../form/use-app-form.ts';
import { Button } from '../ui/button/button.tsx';
import { Dialog } from '../ui/dialog/dialog.tsx';
import { DialogContent } from '../ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../ui/dialog/dialog-title.tsx';
import { ReasonField } from './reason-field.tsx';
import { REASON_SCHEMAS } from './reason-schema.ts';

export type ConfirmActionReason = 'required' | 'optional' | 'none';

export interface ConfirmActionInput {
  readonly reason: string | undefined;
}

export interface ConfirmActionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly reason: ConfirmActionReason;
  readonly audited: boolean;
  // 失敗は例外で知らせる
  readonly onConfirm: (input: ConfirmActionInput) => Promise<void>;
  readonly failureMessageOf: (error: unknown) => string;
  // 確定で開いた元の要素が消える操作(削除など)で、閉じた後のフォーカスの移り先
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

interface ReasonFormInput {
  reason?: string;
}

interface ReasonFormOutput {
  readonly reason?: string | undefined;
}

const FORM_SCHEMAS: Readonly<
  Record<ConfirmActionReason, z.ZodType<ReasonFormOutput, ReasonFormInput>>
> = Object.freeze({
  required: z.object({ reason: REASON_SCHEMAS.required }),
  optional: z.object({ reason: REASON_SCHEMAS.optional }),
  none: z.object({}),
});

const DEFAULT_VALUES: Readonly<Record<ConfirmActionReason, ReasonFormInput>> =
  Object.freeze({
    required: Object.freeze({ reason: '' }),
    optional: Object.freeze({ reason: '' }),
    none: Object.freeze({}),
  });

interface ConfirmActionFormProps {
  readonly reason: ConfirmActionReason;
  readonly audited: boolean;
  readonly confirmLabel: string;
  readonly pending: boolean;
  readonly onSubmit: (input: ConfirmActionInput) => Promise<void>;
  readonly failureMessageOf: (error: unknown) => string;
  readonly onCancel: () => void;
}

// ダイアログを閉じると中身が取り除かれるため、開くたびに理由の入力と失敗の表示を始め直す
function ConfirmActionForm({
  reason,
  audited,
  confirmLabel,
  pending,
  onSubmit,
  failureMessageOf,
  onCancel,
}: ConfirmActionFormProps) {
  const form = useAppForm(FORM_SCHEMAS[reason], {
    defaultValues: { ...DEFAULT_VALUES[reason] },
  });
  const [failure, setFailure] = useState<string>();

  return (
    <AppForm
      form={form}
      onSubmit={async (values) => {
        setFailure(undefined);
        await onSubmit({ reason: values.reason });
      }}
      onSubmitError={(error) => {
        setFailure(failureMessageOf(error));
      }}
      className="flex flex-col gap-4"
    >
      {failure === undefined ? null : (
        <FormMessage role="alert">{failure}</FormMessage>
      )}
      {reason === 'none' ? null : (
        <ReasonField
          control={form.control}
          name="reason"
          required={reason === 'required'}
        />
      )}
      {audited ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <ScrollTextIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <span>{AUDITED_ACTION_NOTICE}</span>
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          aria-disabled={pending ? true : undefined}
          onClick={onCancel}
        >
          {CONFIRM_ACTION_CANCEL_LABEL}
        </Button>
        <SubmitButton variant="destructive">{confirmLabel}</SubmitButton>
      </DialogFooter>
    </AppForm>
  );
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  reason,
  audited,
  onConfirm,
  failureMessageOf,
  returnFocusRef,
}: ConfirmActionDialogProps) {
  const [pending, setPending] = useState(false);
  // 処理中の状態は再描画の後に効くため、同じ描画の間に届いた閉じる操作もここで止める
  const pendingRef = useRef(false);
  const openerRef = useRef<Element | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // 確定の途中で閉じると、失敗の文言を示す場所が無くなるため、処理中は閉じない
  const requestClose = (): void => {
    if (!pendingRef.current) {
      onOpenChange(false);
    }
  };

  const confirm = async (input: ConfirmActionInput): Promise<void> => {
    pendingRef.current = true;
    setPending(true);
    try {
      await onConfirm(input);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      // 開く元の要素を持たず状態で開くため、部品から届くのは閉じる要求だけ
      onOpenChange={(next) => {
        if (!next) {
          requestClose();
        }
      }}
    >
      <DialogContent
        ref={contentRef}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        closeButtonDisabled={pending}
        onBlur={(event) => {
          // 処理中に受け付けなかったダイアログの外の押下は、フォーカスを<body>へ落として戻さないため、ダイアログへ戻す。ウィンドウの切り替えではフォーカスのある要素が変わらないため何もしない
          if (
            pendingRef.current &&
            event.relatedTarget === null &&
            document.activeElement === document.body
          ) {
            contentRef.current?.focus();
          }
        }}
        onOpenAutoFocus={() => {
          openerRef.current = document.activeElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusRef?.current ?? openerRef.current;
          if (target instanceof HTMLElement && target.isConnected) {
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ConfirmActionForm
          key={reason}
          reason={reason}
          audited={audited}
          confirmLabel={confirmLabel}
          pending={pending}
          onSubmit={confirm}
          failureMessageOf={failureMessageOf}
          onCancel={requestClose}
        />
      </DialogContent>
    </Dialog>
  );
}
