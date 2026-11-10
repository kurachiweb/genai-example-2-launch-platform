import { useId } from 'react';

import { Label } from '../../../lib/components/ui/label/label.tsx';
import { Switch } from '../../../lib/components/ui/switch/switch.tsx';
import {
  AUTO_REFRESH_DESCRIPTION,
  AUTO_REFRESH_LABEL,
} from './auto-refresh-messages.ts';

export interface AutoRefreshSwitchProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

// ページの全ての区画の定期の取り直し・毎秒の数値の更新・演出を1つで止めるため、区画の見出しの近くではなくページの上部に置く
export function AutoRefreshSwitch({
  checked,
  onCheckedChange,
}: AutoRefreshSwitchProps) {
  const switchId = useId();
  const descriptionId = useId();
  return (
    <div className="flex flex-col justify-center gap-1.5 rounded-xl border border-border bg-card p-2 text-card-foreground shadow-sm sm:p-3">
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          aria-describedby={descriptionId}
        />
        <Label htmlFor={switchId}>{AUTO_REFRESH_LABEL}</Label>
      </div>
      <p id={descriptionId} className="text-xs text-muted-foreground">
        {AUTO_REFRESH_DESCRIPTION}
      </p>
    </div>
  );
}
