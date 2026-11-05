import { useId } from 'react';

import {
  INQUIRY_AUTO_REFRESH_DESCRIPTION,
  INQUIRY_AUTO_REFRESH_LABEL,
} from '../../utilities/messages/inquiry-display-messages.ts';
import { Label } from '../ui/label/label.tsx';
import { Switch } from '../ui/switch/switch.tsx';

export interface InquiryAutoRefreshSwitchProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

// 自動で更新されるメッセージの一覧には止める手段が要るため、定期の取り直しを切り替えるスイッチを区画の見出しの近くに置く
export function InquiryAutoRefreshSwitch({
  checked,
  onCheckedChange,
}: InquiryAutoRefreshSwitchProps) {
  const switchId = useId();
  const descriptionId = useId();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          aria-describedby={descriptionId}
        />
        <Label htmlFor={switchId}>{INQUIRY_AUTO_REFRESH_LABEL}</Label>
      </div>
      <p id={descriptionId} className="text-xs text-muted-foreground">
        {INQUIRY_AUTO_REFRESH_DESCRIPTION}
      </p>
    </div>
  );
}
