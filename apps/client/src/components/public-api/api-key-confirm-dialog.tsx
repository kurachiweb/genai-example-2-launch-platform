import { type RefObject, useRef, useState } from 'react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { z } from '../../../lib/utilities/validation/zod.ts';
import type { ApiKeyFieldsFragment } from '../../graphql/generated/graphql.ts';
import {
  API_KEY_CONFIRM_MESSAGES,
  deleteApiKeyTitleOf,
  reissueApiKeyTitleOf,
} from './api-key-dialog-messages.ts';
import { apiKeyFailureMessageOf } from './api-key-failure-message.ts';
import { API_KEY_FORM_MESSAGES } from './api-key-form-messages.ts';

export type ApiKeyConfirmAction = 'delete' | 'reissue';

export interface ApiKeyConfirmTarget {
  readonly action: ApiKeyConfirmAction;
  readonly apiKey: Pick<ApiKeyFieldsFragment, 'id' | 'name'>;
}

export interface ApiKeyConfirmDialogProps {
  // nullの間は閉じている
  readonly target: ApiKeyConfirmTarget | null;
  readonly onClose: () => void;
  // 閉じた後にフォーカスを戻す、開いた元の操作
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  // 確定の操作。解決でも拒否でも閉じ、拒否は429をレート制限の文言、それ以外をエラーの文言でトーストに示す
  readonly onConfirm: (target: ApiKeyConfirmTarget) => Promise<void>;
}

interface ConfirmCopy {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly destructive: boolean;
}

const copyOf = ({ action, apiKey }: ApiKeyConfirmTarget): ConfirmCopy =>
  action === 'delete'
    ? {
        title: deleteApiKeyTitleOf(apiKey.name),
        description: API_KEY_CONFIRM_MESSAGES.deleteDescription,
        confirmLabel: API_KEY_CONFIRM_MESSAGES.deleteConfirm,
        destructive: true,
      }
    : {
        title: reissueApiKeyTitleOf(apiKey.name),
        description: API_KEY_CONFIRM_MESSAGES.reissueDescription,
        confirmLabel: API_KEY_CONFIRM_MESSAGES.reissueConfirm,
        destructive: false,
      };

// 確認の操作には入力欄が無いため、空の値を送信の状態の管理だけに使う
const CONFIRM_SCHEMA = z.object({});

const EMPTY_VALUES = Object.freeze({});

interface ApiKeyConfirmBodyProps {
  readonly target: ApiKeyConfirmTarget | null;
  readonly pending: boolean;
  readonly onConfirm: (target: ApiKeyConfirmTarget) => Promise<void>;
  readonly onFailed: (error: unknown) => void;
  readonly onCancel: () => void;
}

// 閉じる動きの間は親から対象が届かないため、ダイアログの中身に最後の対象を持たせて題名を保つ
function ApiKeyConfirmBody({
  target,
  pending,
  onConfirm,
  onFailed,
  onCancel,
}: ApiKeyConfirmBodyProps) {
  const [shown, setShown] = useState(target);
  if (target !== null && target !== shown) {
    setShown(target);
  }
  const form = useAppForm(CONFIRM_SCHEMA, { defaultValues: EMPTY_VALUES });
  if (shown === null) {
    return null;
  }
  const copy = copyOf(shown);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <AppForm
        form={form}
        aria-label={copy.title}
        onSubmit={() => onConfirm(shown)}
        onSubmitError={onFailed}
      >
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            aria-disabled={pending ? true : undefined}
            onClick={onCancel}
          >
            {API_KEY_FORM_MESSAGES.cancel}
          </Button>
          <SubmitButton variant={copy.destructive ? 'destructive' : 'default'}>
            {copy.confirmLabel}
          </SubmitButton>
        </DialogFooter>
      </AppForm>
    </>
  );
}

export function ApiKeyConfirmDialog({
  target,
  onClose,
  returnFocusRef,
  onConfirm,
}: ApiKeyConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  // 処理中の状態は再描画の後に効くため、同じ描画の間に届いた閉じる要求もここで止める
  const pendingRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 確定の途中で閉じると結果を示す前に別の操作を始められるため、処理中は閉じない
  const requestClose = (): void => {
    if (!pendingRef.current) {
      onClose();
    }
  };

  const confirm = async (confirmed: ApiKeyConfirmTarget): Promise<void> => {
    pendingRef.current = true;
    setPending(true);
    try {
      await onConfirm(confirmed);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
    onClose();
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          requestClose();
        }
      }}
    >
      <DialogContent
        ref={contentRef}
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
        // 開く元の操作をDialogTriggerにしない呼び出し方では、Radix UIが閉じた後のフォーカスの戻り先を持たないため、開いた元の操作へ戻す
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const element = returnFocusRef.current;
          if (element?.isConnected === true) {
            element.focus();
          }
        }}
      >
        <ApiKeyConfirmBody
          target={target}
          pending={pending}
          onConfirm={confirm}
          onFailed={(error) => {
            notify.error(apiKeyFailureMessageOf(error));
            onClose();
          }}
          onCancel={requestClose}
        />
      </DialogContent>
    </Dialog>
  );
}
