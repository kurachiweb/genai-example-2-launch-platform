import { useState } from 'react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { DialogTrigger } from '../../../lib/components/ui/dialog/dialog-trigger.tsx';
import { SettingsSection } from './settings-section.tsx';
import {
  WITHDRAWAL_ACTION_LABEL,
  WITHDRAWAL_CONFIRM_DESCRIPTION,
  WITHDRAWAL_CONFIRM_TITLE,
  WITHDRAWAL_SECTION_TITLE,
} from './settings-messages.ts';
import { WithdrawalForm } from './withdrawal-form.tsx';
import { WithdrawalImpacts } from './withdrawal-impacts.tsx';

export interface WithdrawalSectionProps {
  readonly totpEnabled: boolean;
}

export function WithdrawalSection({ totpEnabled }: WithdrawalSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <SettingsSection title={WITHDRAWAL_SECTION_TITLE}>
      <WithdrawalImpacts />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="destructive" className="self-start">
            {WITHDRAWAL_ACTION_LABEL}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{WITHDRAWAL_CONFIRM_TITLE}</DialogTitle>
            <DialogDescription>
              {WITHDRAWAL_CONFIRM_DESCRIPTION}
            </DialogDescription>
          </DialogHeader>
          <WithdrawalImpacts />
          <WithdrawalForm totpEnabled={totpEnabled} />
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
