import { useRef } from 'react';

import { Tabs } from '../../../lib/components/ui/tabs/tabs.tsx';
import { TabsContent } from '../../../lib/components/ui/tabs/tabs-content.tsx';
import { TabsList } from '../../../lib/components/ui/tabs/tabs-list.tsx';
import { TabsTrigger } from '../../../lib/components/ui/tabs/tabs-trigger.tsx';
import type { FollowListDirection } from '../../graphql/follow-list.ts';
import { FollowList } from './follow-list.tsx';
import {
  FOLLOW_LIST_PAGE_TITLE,
  FOLLOW_LIST_TAB_LABELS,
  FOLLOW_LIST_TABS_LABEL,
} from './follow-list-messages.ts';

export interface FollowListPageProps {
  readonly viewerId: string;
  readonly direction: FollowListDirection;
  readonly onDirectionChange: (direction: FollowListDirection) => void;
}

const DIRECTIONS: readonly FollowListDirection[] = Object.freeze([
  'following',
  'followers',
]);

const isDirection = (value: string): value is FollowListDirection =>
  DIRECTIONS.some((direction) => direction === value);

export function FollowListPage({
  viewerId,
  direction,
  onDirectionChange,
}: FollowListPageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  return (
    <div className="flex flex-col gap-6">
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {FOLLOW_LIST_PAGE_TITLE}
      </h1>
      <Tabs
        value={direction}
        onValueChange={(next) => {
          if (isDirection(next)) {
            onDirectionChange(next);
          }
        }}
        className="min-w-0 gap-0"
      >
        <TabsList
          variant="line"
          aria-label={FOLLOW_LIST_TABS_LABEL}
          className="h-auto w-full justify-start gap-0 border-b border-border p-0 sm:w-fit"
        >
          {DIRECTIONS.map((id) => (
            <TabsTrigger
              key={id}
              value={id}
              className="h-auto min-h-12 text-sm font-bold after:bg-primary sm:flex-none sm:px-4 sm:text-base"
            >
              {FOLLOW_LIST_TAB_LABELS[id]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent
          key={direction}
          value={direction}
          className="mt-5 rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <FollowList
            key={direction}
            viewerId={viewerId}
            direction={direction}
            retryFocusRef={headingRef}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
