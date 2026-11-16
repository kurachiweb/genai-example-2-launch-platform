import { useId, useState } from 'react';

import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { useNow } from '../../../lib/components/datetime/use-now.ts';
import { Tooltip } from '../../../lib/components/ui/tooltip/tooltip.tsx';
import { TooltipContent } from '../../../lib/components/ui/tooltip/tooltip-content.tsx';
import { TooltipTrigger } from '../../../lib/components/ui/tooltip/tooltip-trigger.tsx';
import { formatDateTime } from '../../../lib/utilities/datetime/date-time-formats.ts';
import { toDateTimeValue } from '../../../lib/utilities/datetime/date-time-value.ts';
import { formatElapsed } from '../../../lib/utilities/datetime/relative-time.ts';

export interface CommentTimeProps {
  // 時差を含むISO形式の投稿日時
  readonly value: string;
}

// 30日未満は経過の表現、30日以上前は年を付けない月日と曜日で示す。経過の表現はハイドレーションの後に出し、それまでは月日と曜日で示す
export function CommentTime({ value }: CommentTimeProps) {
  const preferences = useDisplayPreferences();
  const now = useNow();
  const date = toDateTimeValue(value);
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const elapsed = now === null ? null : formatElapsed(date, new Date(now));
  const fullDateTime = formatDateTime(date, 'longDateTime', preferences);
  return (
    <>
      <Tooltip open={open} onOpenChange={setOpen}>
        {/* 非対話の要素はフォーカスの対象にできないため、フォーカスでツールチップを開く引き金をボタンにする。開いている間はツールチップが説明になるため、閉じている間だけ同じ日時を説明として結び付け、二重に読ませない */}
        <TooltipTrigger
          asChild
          aria-describedby={open ? undefined : descriptionId}
        >
          <button
            type="button"
            className="cursor-default rounded-sm text-xs text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <time dateTime={date.toISOString()}>
              {elapsed ?? formatDateTime(date, 'dateWeekday', preferences)}
            </time>
          </button>
        </TooltipTrigger>
        <TooltipContent>{fullDateTime}</TooltipContent>
      </Tooltip>
      {/* 本文としては読み上げさせず、説明の参照先にだけ使う */}
      <span id={descriptionId} hidden>
        {fullDateTime}
      </span>
    </>
  );
}
