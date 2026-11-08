import { UserPlusIcon } from 'lucide-react';
import { useId } from 'react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Tooltip } from '../../../lib/components/ui/tooltip/tooltip.tsx';
import { TooltipContent } from '../../../lib/components/ui/tooltip/tooltip-content.tsx';
import { TooltipTrigger } from '../../../lib/components/ui/tooltip/tooltip-trigger.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import type { FollowButtonSize } from './follow-button-types.ts';
import {
  FOLLOW_EMAIL_UNVERIFIED_REASON,
  FOLLOW_LABEL,
} from './profile-messages.ts';

export interface FollowUnverifiedButtonProps {
  readonly size: FollowButtonSize;
  readonly className?: string | undefined;
}

// 無効のボタンはポインターを受けないため、外枠をツールチップの起点にする。フォーカスは受けられないため、読み上げ用には同じ理由を説明として結び付け、確認が必要な旨は共通ヘッダー直下の帯も示す
export function FollowUnverifiedButton({
  size,
  className,
}: FollowUnverifiedButtonProps) {
  const reasonId = useId();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-slot="follow-button-unverified"
          className={cn('inline-flex rounded-md', className)}
        >
          <Button
            type="button"
            size={size}
            variant="outline"
            disabled
            aria-describedby={reasonId}
            className="w-full"
          >
            <UserPlusIcon aria-hidden="true" />
            {FOLLOW_LABEL}
          </Button>
          <span id={reasonId} className="sr-only">
            {FOLLOW_EMAIL_UNVERIFIED_REASON}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{FOLLOW_EMAIL_UNVERIFIED_REASON}</TooltipContent>
    </Tooltip>
  );
}
