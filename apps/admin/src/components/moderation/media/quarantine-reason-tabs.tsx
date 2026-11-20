import type { ReactNode, RefObject } from 'react';

import {
  QUARANTINE_REASON_LABELS,
  QUARANTINE_REASONS,
  type QuarantineReason,
} from '../../../../common-lib/moderation/moderation-labels.ts';
import { Tabs } from '../../../../lib/components/ui/tabs/tabs.tsx';
import { TabsContent } from '../../../../lib/components/ui/tabs/tabs-content.tsx';
import { TabsList } from '../../../../lib/components/ui/tabs/tabs-list.tsx';
import { TabsTrigger } from '../../../../lib/components/ui/tabs/tabs-trigger.tsx';
import {
  QUARANTINE_REASON_TAB_ORDER,
  QUARANTINE_REASON_TABS_LABEL,
} from '../shared/moderation-messages.ts';

export interface QuarantineReasonTabsProps {
  readonly reason: QuarantineReason;
  readonly onReasonChange: (reason: QuarantineReason) => void;
  // 選んだ理由の区画。再試行や措置の後に消える操作からのフォーカスの移り先にする
  readonly panelRef: RefObject<HTMLDivElement | null>;
  readonly children: ReactNode;
}

const isQuarantineReason = (value: string): value is QuarantineReason =>
  QUARANTINE_REASONS.some((reason) => reason === value);

// 隔離理由のタブと、選んだ理由の区画。タブの間の移動はRadix UIの部品が矢印キーで提供する
export function QuarantineReasonTabs({
  reason,
  onReasonChange,
  panelRef,
  children,
}: QuarantineReasonTabsProps) {
  return (
    <Tabs
      value={reason}
      onValueChange={(next) => {
        if (isQuarantineReason(next)) {
          onReasonChange(next);
        }
      }}
      className="min-w-0 gap-0"
    >
      <TabsList
        variant="line"
        aria-label={QUARANTINE_REASON_TABS_LABEL}
        className="h-auto w-full flex-wrap justify-start gap-0 border-b border-border p-0"
      >
        {QUARANTINE_REASON_TAB_ORDER.map((value) => (
          <TabsTrigger
            key={value}
            value={value}
            className="h-auto min-h-12 flex-none px-3 text-sm font-bold after:bg-primary sm:px-4 sm:text-base"
          >
            {QUARANTINE_REASON_LABELS[value]}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent
        ref={panelRef}
        value={reason}
        className="mt-5 rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {children}
      </TabsContent>
    </Tabs>
  );
}
