import { type RefObject, useState } from 'react';

import { COMMENT_BOT_ACTIONS } from '../../../common-lib/engagement/engagement-rules.ts';
import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogClose } from '../../../lib/components/ui/dialog/dialog-close.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { BOT_CHECK_FAILED_MESSAGE } from '../../../lib/utilities/messages/bot-protection-messages.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  COMMENT_CANCEL_LABEL,
  COMMENT_DELETE_CONFIRM_DESCRIPTION,
  COMMENT_DELETE_CONFIRM_TITLE,
  COMMENT_DELETE_LABEL,
} from './comment-messages.ts';

export interface DeleteCommentDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  // 閉じた後にフォーカスを戻す、開いた元の操作
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  // 削除の操作。解決すると閉じ、拒否するとダイアログを開いたまま失敗の文言を示す
  readonly onConfirm: (turnstileToken: string) => Promise<void>;
}

// 確認の操作には入力欄が無いため、空の値を送信の状態の管理だけに使う
const CONFIRM_SCHEMA = z.object({});

const EMPTY_VALUES = Object.freeze({});

interface DeleteConfirmFormProps {
  readonly onConfirm: (turnstileToken: string) => Promise<void>;
  readonly onDeleted: () => void;
}

function DeleteConfirmForm({ onConfirm, onDeleted }: DeleteConfirmFormProps) {
  const form = useAppForm(CONFIRM_SCHEMA, { defaultValues: EMPTY_VALUES });
  const turnstile = useTurnstileToken();
  const [submitError, setSubmitError] = useState<string>();
  const [tokenUnavailable, setTokenUnavailable] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const tokenPending = turnstile.token === undefined;
  // トークンの用意を待つ間は押せなくする。フォーカスのあるボタンを無効にするとフォーカスを失うため、フォーカスが離れるまでaria-disabledにし、その間の確定はトークンを待ってから送る
  const pendingWhileFocused = tokenPending && confirmFocused;

  return (
    <AppForm
      form={form}
      aria-label={COMMENT_DELETE_CONFIRM_TITLE}
      onSubmit={async () => {
        setSubmitError(undefined);
        setTokenUnavailable(false);
        const turnstileToken = await turnstile.waitForToken();
        if (turnstileToken === undefined) {
          setTokenUnavailable(true);
          return;
        }
        await onConfirm(turnstileToken);
        onDeleted();
      }}
      onSubmitError={(error) => {
        setSubmitError(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      }}
      className="flex flex-col gap-4"
    >
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={COMMENT_BOT_ACTIONS.delete}
      />
      {tokenUnavailable && turnstile.status !== 'error' ? (
        <FormMessage role="alert">{BOT_CHECK_FAILED_MESSAGE}</FormMessage>
      ) : null}
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {COMMENT_CANCEL_LABEL}
          </Button>
        </DialogClose>
        <SubmitButton
          variant="destructive"
          disabled={tokenPending && !confirmFocused}
          {...(pendingWhileFocused ? { 'aria-disabled': true } : {})}
          onFocus={() => {
            setConfirmFocused(true);
          }}
          onBlur={() => {
            setConfirmFocused(false);
          }}
        >
          {COMMENT_DELETE_LABEL}
        </SubmitButton>
      </DialogFooter>
    </AppForm>
  );
}

// 確定するまで削除しない。閉じた内容は破棄し、開き直すと失敗の文言とトークンを初めから用意する
export function DeleteCommentDialog({
  open,
  onOpenChange,
  returnFocusRef,
  onConfirm,
}: DeleteCommentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // 開く元の操作をDialogTriggerにしない呼び出し方では、Radix UIが閉じた後のフォーカスの戻り先を持たないため、開いた元の操作へ戻す
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusRef.current;
          if (target?.isConnected === true) {
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{COMMENT_DELETE_CONFIRM_TITLE}</DialogTitle>
          <DialogDescription>
            {COMMENT_DELETE_CONFIRM_DESCRIPTION}
          </DialogDescription>
        </DialogHeader>
        <DeleteConfirmForm
          onConfirm={onConfirm}
          onDeleted={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
