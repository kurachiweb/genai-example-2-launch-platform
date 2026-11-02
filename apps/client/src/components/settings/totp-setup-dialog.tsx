import { type RefObject, useState } from 'react';

import { RecoveryCodeList } from '../../../lib/components/auth/recovery-code-list.tsx';
import { TotpQrCode } from '../../../lib/components/auth/totp-qr-code.tsx';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { TOTP_QR_CODE_LABEL } from '../../../lib/utilities/messages/auth-messages.ts';
import type { ClientStartTotpSetupMutation } from '../../graphql/generated/graphql.ts';
import { ResultNotice } from '../auth/result-notice.tsx';
import {
  RECOVERY_CODES_SHOWN_ONCE_MESSAGE,
  TOTP_ENABLED_MESSAGE,
  TOTP_MANUAL_ENTRY_LABEL,
  TOTP_SETUP_DIALOG_DESCRIPTION,
  TOTP_SETUP_DIALOG_TITLE,
  TOTP_SETUP_EXPIRES_PREFIX,
  TOTP_SETUP_EXPIRES_SUFFIX,
} from './settings-messages.ts';
import { TotpEnableForm } from './totp-enable-form.tsx';

export type TotpSetup = ClientStartTotpSetupMutation['startTotpSetup'];

export interface TotpSetupDialogProps {
  // nullの間は閉じている
  readonly setup: TotpSetup | null;
  readonly onClose: () => void;
  readonly onEnabled: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

export function TotpSetupDialog({
  setup,
  onClose,
  onEnabled,
  returnFocusRef,
}: TotpSetupDialogProps) {
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>();

  return (
    <Dialog
      open={setup !== null}
      onOpenChange={(open) => {
        if (!open) {
          setRecoveryCodes(undefined);
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        // 状態で開くため、開いた元の送信ボタンではなく、有効・無効が変わっても残る状態の文へ戻す
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{TOTP_SETUP_DIALOG_TITLE}</DialogTitle>
          <DialogDescription>
            {recoveryCodes === undefined
              ? TOTP_SETUP_DIALOG_DESCRIPTION
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
            <TotpEnableForm
              onEnabled={(codes) => {
                setRecoveryCodes(codes);
                onEnabled();
              }}
            />
          </>
        ) : (
          <>
            <ResultNotice tone="success" message={TOTP_ENABLED_MESSAGE} />
            <RecoveryCodeList codes={recoveryCodes} />
            <DialogFooter showCloseButton />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
