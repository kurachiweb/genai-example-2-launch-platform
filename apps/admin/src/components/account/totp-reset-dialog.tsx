import { type RefObject, useRef, useState } from 'react';

import { RecoveryCodeList } from '../../../lib/components/auth/recovery-code-list.tsx';
import { TotpQrCode } from '../../../lib/components/auth/totp-qr-code.tsx';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { ResultNotice } from '../../../lib/components/feedback/result-notice.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { TOTP_QR_CODE_LABEL } from '../../../lib/utilities/messages/auth-messages.ts';
import type { AdminStartTotpResetMutation } from '../../graphql/generated/graphql.ts';
import {
  RECOVERY_CODES_SHOWN_ONCE_MESSAGE,
  TOTP_MANUAL_ENTRY_LABEL,
  TOTP_SETUP_DESCRIPTION,
  TOTP_SETUP_EXPIRES_PREFIX,
  TOTP_SETUP_EXPIRES_SUFFIX,
} from '../auth/admin-auth-messages.ts';
import {
  TOTP_RESET_COMPLETED_MESSAGE,
  TOTP_RESET_LABEL,
} from './account-messages.ts';
import { TotpResetForm } from './totp-reset-form.tsx';

export type TotpResetSetup = AdminStartTotpResetMutation['startAdminTotpReset'];

export interface TotpResetDialogProps {
  // nullの間は閉じている
  readonly setup: TotpResetSetup | null;
  readonly onClose: () => void;
  readonly onCompleted: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

export function TotpResetDialog({
  setup,
  onClose,
  onCompleted,
  returnFocusRef,
}: TotpResetDialogProps) {
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>();
  // 完了の処理中に閉じると、新しい秘密鍵への置き換えとリカバリコードの再発行は済むのに新しいリカバリコードを一度も示せないため、処理中は閉じる要求を受け付けない。処理中の状態は再描画の後に効くため、同じ描画の間に届いた閉じる要求もrefで止める
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const cancel = (): void => {
    if (!pendingRef.current) {
      setRecoveryCodes(undefined);
      onClose();
    }
  };

  const run = async (action: () => Promise<void>): Promise<void> => {
    pendingRef.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog
      open={setup !== null}
      onOpenChange={(open) => {
        if (!open) {
          cancel();
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
        // 送信の結果で開き、開いた元の送信ボタンは入力の初期化で無効になってフォーカスを受け取れないため、渡された要素へ戻す
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{TOTP_RESET_LABEL}</DialogTitle>
          <DialogDescription>
            {recoveryCodes === undefined
              ? TOTP_SETUP_DESCRIPTION
              : RECOVERY_CODES_SHOWN_ONCE_MESSAGE}
          </DialogDescription>
        </DialogHeader>
        {setup === null ? null : recoveryCodes === undefined ? (
          <>
            <div className="flex flex-col items-center gap-4">
              <TotpQrCode uri={setup.otpauthUri} label={TOTP_QR_CODE_LABEL} />
              <div className="flex w-full min-w-0 flex-col gap-2 text-sm">
                <p>{TOTP_MANUAL_ENTRY_LABEL}</p>
                <code
                  translate="no"
                  className="rounded-md border border-border bg-muted px-3 py-2 font-mono break-all text-foreground"
                >
                  {setup.secret}
                </code>
                <p className="text-muted-foreground">
                  {TOTP_SETUP_EXPIRES_PREFIX}
                  <DateTime value={setup.expiresAt} format="time" />
                  {TOTP_SETUP_EXPIRES_SUFFIX}
                </p>
              </div>
            </div>
            <TotpResetForm
              pending={pending}
              run={run}
              onCancel={cancel}
              onCompleted={(codes) => {
                setRecoveryCodes(codes);
                onCompleted();
              }}
            />
          </>
        ) : (
          <>
            <ResultNotice
              tone="success"
              message={TOTP_RESET_COMPLETED_MESSAGE}
            />
            <RecoveryCodeList codes={recoveryCodes} />
            <DialogFooter showCloseButton />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
