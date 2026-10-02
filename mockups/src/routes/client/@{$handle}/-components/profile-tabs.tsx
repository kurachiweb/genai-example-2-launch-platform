import { useEffect, useRef, useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { cn } from '#/lib/utils';

import { TABS } from '../-model/options';
import type { ProfileState, ProfileTab } from '../-model/options';
import type { ProfileModel } from '../-model/page-model';
import { LaunchedProductsPanel } from './launched-products-panel';
import { TabBody } from './tab-body';
import { UpvoteHistoryPanel } from './upvote-history-panel';

type Props = {
  model: ProfileModel;
  state: ProfileState;
  tab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
};

// 本番に近い体感を確認できるよう、タブを切り替えるたびに読み込みを挟む
const TAB_LATENCY_MS = 600;
// 追従する共通ヘッダーの高さ(h-14)
const SITE_HEADER_PX = 56;

const LABELS: Record<ProfileTab, string> = {
  launches: 'ローンチ履歴',
  upvotes: 'Upvote履歴',
};

function isTab(value: string): value is ProfileTab {
  return (TABS as readonly string[]).includes(value);
}

export function ProfileTabs({ model, state, tab, onTabChange }: Props) {
  // URLのタブ(ブラウザの戻る・進むを含む)と表示中の内容がずれている間を読み込み中とみなす
  const [shownTab, setShownTab] = useState(tab);
  const anchor = useRef<HTMLDivElement>(null);
  const counts: Record<ProfileTab, number> = {
    launches: model.products.length,
    upvotes: model.upvotes.length,
  };

  useEffect(() => {
    if (shownTab === tab) return;
    const timer = window.setTimeout(() => setShownTab(tab), TAB_LATENCY_MS);
    return () => window.clearTimeout(timer);
  }, [tab, shownTab]);

  // 一覧を読み進めてタブバーが追従している場合は、切り替えた内容の先頭から読めるようタブの位置まで戻す
  const change = (value: string) => {
    if (!isTab(value)) return;
    const top = anchor.current?.getBoundingClientRect().top;
    if (top !== undefined && top < SITE_HEADER_PX) {
      const reduced = document.documentElement.dataset.motion === 'off';
      window.scrollTo({
        top: window.scrollY + top - SITE_HEADER_PX,
        behavior: reduced ? 'auto' : 'smooth',
      });
    }
    onTabChange(value);
  };

  const loading = state.load === 'tab-loading' || shownTab !== tab;

  return (
    <Tabs value={tab} onValueChange={change} className="min-w-0 gap-0">
      <div ref={anchor} aria-hidden="true" />
      <div className="sticky top-14 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-1 backdrop-blur supports-backdrop-filter:bg-background/80 sm:py-0 lg:mx-0 lg:px-0">
        <TabsList
          variant="line"
          aria-label="プロフィールの内容"
          className="grid h-auto w-full grid-cols-2 gap-0 p-0 sm:flex sm:w-fit"
        >
          {TABS.map((value) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-auto min-h-12 gap-1.5 text-sm font-bold whitespace-normal after:bg-primary sm:flex-none sm:gap-2 sm:px-4 sm:text-base"
            >
              <span>{LABELS[value]}</span>
              <span
                className={cn(
                  'scoreboard-digits rounded-full px-2 py-0.5 text-xs',
                  value === tab
                    ? 'bg-primary/12 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {counts[value].toLocaleString()}
                <span className="sr-only">件</span>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {TABS.map((value) => (
        <TabsContent
          key={value}
          value={value}
          className="mt-5 rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <h2 className="sr-only">{LABELS[value]}</h2>
          <TabBody
            tab={value}
            loading={loading}
            failing={state.partial === 'tab'}
          >
            {value === 'launches' ? (
              <LaunchedProductsPanel
                model={model}
                loadMoreFails={state.partial === 'more'}
              />
            ) : (
              <UpvoteHistoryPanel
                model={model}
                loadMoreFails={state.partial === 'more'}
              />
            )}
          </TabBody>
        </TabsContent>
      ))}
    </Tabs>
  );
}
