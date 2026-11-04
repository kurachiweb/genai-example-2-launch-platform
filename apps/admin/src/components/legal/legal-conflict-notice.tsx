import { CircleAlertIcon, RotateCwIcon } from 'lucide-react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  LEGAL_CONFLICT_MESSAGE,
  RELOAD_LATEST_LABEL,
} from './legal-editor-messages.ts';

export interface LegalConflictNoticeProps {
  readonly onReload: () => void;
}

export function LegalConflictNotice({ onReload }: LegalConflictNoticeProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive bg-card p-4 text-sm">
      <p role="alert" className="flex items-start gap-1.5 font-semibold">
        <CircleAlertIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-destructive"
        />
        <span>{LEGAL_CONFLICT_MESSAGE}</span>
      </p>
      {/* 下書きの入力欄のフォームの中に置かれるため、送信のボタンにしない */}
      <Button type="button" variant="outline" size="sm" onClick={onReload}>
        <RotateCwIcon aria-hidden="true" />
        {RELOAD_LATEST_LABEL}
      </Button>
    </div>
  );
}
