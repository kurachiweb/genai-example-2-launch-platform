import { HistoryIcon } from 'lucide-react';
import type { ComponentType } from 'react';

import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { formatNumber } from '../../../lib/utilities/number/number-format.ts';
import { SectionHeading } from '../top/section-heading.tsx';
import { LaunchBlock } from './launch-block.tsx';
import { matchCountOf } from './match-history-model.ts';
import {
  MATCH_HISTORY_HEADING_ID,
  MATCH_HISTORY_TITLE,
  matchHistoryCountLabel,
} from './match-history-messages.ts';
import { orderProductLaunchSections } from './product-page-section-order.ts';
import type {
  ProductLaunchSection,
  ProductPageContext,
} from './product-page-section-types.ts';

export interface MatchHistorySectionProps extends ProductPageContext {
  // ローンチの区画の登録口(PRODUCT_LAUNCH_SECTIONS)
  readonly launchSections: readonly ProductLaunchSection[];
}

// 取り消されていないローンチを受け取った新しい順のブロックで並べる。ローンチが無ければ何も描かない
export function MatchHistorySection({
  product,
  viewer,
  page,
  launchSections,
}: MatchHistorySectionProps) {
  const preferences = useDisplayPreferences();
  const { launches } = page;
  if (launches.length === 0) {
    return null;
  }
  const ordered = orderProductLaunchSections(launchSections);
  const context = { product, viewer };
  return (
    <section aria-labelledby={MATCH_HISTORY_HEADING_ID}>
      <SectionHeading
        id={MATCH_HISTORY_HEADING_ID}
        icon={
          <HistoryIcon className="size-5 text-primary" aria-hidden="true" />
        }
        title={MATCH_HISTORY_TITLE}
        meta={matchHistoryCountLabel(
          formatNumber(launches.length, preferences),
          formatNumber(matchCountOf(launches), preferences),
        )}
      />
      <div className="mt-4 flex flex-col gap-5">
        {launches.map((launch) => (
          <LaunchBlock
            key={launch.id}
            launch={launch}
            context={context}
            launchSections={ordered}
          />
        ))}
      </div>
    </section>
  );
}

// 登録口と区画の部品が互いを読み込むと循環するため、登録する側がローンチの区画の登録口を渡して区画の部品を作る
export const matchHistorySectionOf = (
  launchSections: readonly ProductLaunchSection[],
): ComponentType<ProductPageContext> =>
  function MatchHistorySectionWithLaunchSections(context: ProductPageContext) {
    return <MatchHistorySection {...context} launchSections={launchSections} />;
  };
