import { useRef } from 'react';

import { Tabs } from '../../../lib/components/ui/tabs/tabs.tsx';
import { TabsContent } from '../../../lib/components/ui/tabs/tabs-content.tsx';
import { TabsList } from '../../../lib/components/ui/tabs/tabs-list.tsx';
import { TabsTrigger } from '../../../lib/components/ui/tabs/tabs-trigger.tsx';
import { ProfileTabCount } from './profile-tab-count.tsx';
import { ProfileTabPanel } from './profile-tab-panel.tsx';
import { PROFILE_TABS_LABEL } from './profile-messages.ts';
import {
  orderPublicProfileSections,
  profileTabQueryValue,
  resolveProfileTab,
} from './public-profile-section-order.ts';
import type {
  PublicProfileSectionContext,
  PublicProfileTab,
} from './public-profile-section-types.ts';

export interface ProfileTabsProps {
  readonly tabs: readonly PublicProfileTab[];
  readonly context: PublicProfileSectionContext;
  // URLのクエリ`tab`の値
  readonly tab: string | undefined;
  // 先頭のタブはクエリから省くため`undefined`で渡す。履歴への積み方とスクロールの復元は呼び出し側が決める
  readonly onTabChange: (tab: string | undefined) => void;
}

// 共通ヘッダーの高さ(`top-14`)。タブバーの本来の位置がこれより上なら、タブバーはヘッダーの下に追従している
const SITE_HEADER_PX = 56;

// 切り替えた内容を先頭から読めるよう、追従中だけ元のタブバーの位置までスクロールを戻す
function scrollBackToTabs(anchor: HTMLElement | null): void {
  if (anchor === null) {
    return;
  }
  const { top } = anchor.getBoundingClientRect();
  if (top >= SITE_HEADER_PX) {
    return;
  }
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  window.scrollTo({
    top: window.scrollY + top - SITE_HEADER_PX,
    behavior: reducedMotion ? 'auto' : 'smooth',
  });
}

export function ProfileTabs({
  tabs,
  context,
  tab,
  onTabChange,
}: ProfileTabsProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const active = resolveProfileTab(tabs, tab);
  if (active === undefined) {
    return null;
  }

  const handleChange = (id: string): void => {
    scrollBackToTabs(anchorRef.current);
    onTabChange(profileTabQueryValue(tabs, id));
  };

  return (
    <Tabs
      value={active.id}
      onValueChange={handleChange}
      className="min-w-0 gap-0"
    >
      <div ref={anchorRef} aria-hidden="true" />
      <div className="sticky top-14 z-30 -mx-4 border-b border-border bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80 lg:mx-0 lg:px-0">
        <TabsList
          variant="line"
          aria-label={PROFILE_TABS_LABEL}
          className="h-auto w-full justify-start gap-0 p-0 sm:w-fit"
        >
          {orderPublicProfileSections(tabs).map(({ id, label, Count }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="h-auto min-h-12 gap-1.5 text-sm font-bold whitespace-normal after:bg-primary sm:flex-none sm:gap-2 sm:px-4 sm:text-base"
            >
              <span>{label}</span>
              {Count === undefined ? null : (
                <ProfileTabCount
                  Count={Count}
                  context={context}
                  selected={id === active.id}
                />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent
        key={active.id}
        value={active.id}
        className="mt-5 rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <h2 className="sr-only">{active.label}</h2>
        <ProfileTabPanel Panel={active.Panel} context={context} />
      </TabsContent>
    </Tabs>
  );
}
