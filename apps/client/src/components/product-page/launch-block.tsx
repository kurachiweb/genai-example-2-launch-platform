import { useId } from 'react';

import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { LaunchDateText } from '../product/launch-date-text.tsx';
import { EmptyMatches } from './empty-matches.tsx';
import type { ProductPageLaunchView } from './match-history-model.ts';
import {
  launchBlockTitle,
  launchMatchesLabel,
} from './match-history-messages.ts';
import { MatchHistoryRow } from './match-history-row.tsx';
import type {
  ProductLaunchSection,
  ProductOwnerActionContext,
} from './product-page-section-types.ts';

export interface LaunchBlockProps {
  readonly launch: ProductPageLaunchView;
  // ローンチの区画へ渡すページの値
  readonly context: ProductOwnerActionContext;
  // orderの順に並べ終えたローンチの区画
  readonly launchSections: readonly ProductLaunchSection[];
}

// 区画が描けた間(目印の要素がある間)は境界の枠をdisplay:contentsにし、何も描かない区画の枠と間隔を残さない。
// display:contentsの要素はフォーカスできないため、再試行の後に枠へフォーカスを移す読み込み中と失敗の間は通常の箱のまま残す
const LAUNCH_SECTION_SLOT_CLASS =
  'has-[>[data-product-launch-section-rendered]]:contents';

// マッチ履歴のローンチ1回分。見出しと結果の確定したマッチの一覧(無ければ案内)の下に、登録されたローンチの区画を1つずつエラーの境界で包んで並べる
export function LaunchBlock({
  launch,
  context,
  launchSections,
}: LaunchBlockProps) {
  const titleId = useId();
  const sectionLaunch = {
    id: launch.id,
    number: launch.number,
    kickedOff: launch.kickedOff,
    latestKickedOff: launch.latestKickedOff,
  };
  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card/70 p-4 text-card-foreground shadow-xs sm:p-5"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={titleId} className="text-lg font-extrabold tracking-tight">
          {launchBlockTitle(launch.number)}
        </h3>
        <span className="text-sm text-muted-foreground">
          <LaunchDateText date={launch.launchDate} />
        </span>
        <Badge
          variant={launch.summary.inMatch ? 'default' : 'secondary'}
          className="font-bold"
        >
          {launch.summary.label}
        </Badge>
      </header>
      {launch.matches.length > 0 ? (
        <ol
          aria-label={launchMatchesLabel(launch.number)}
          className="space-y-2.5"
        >
          {launch.matches.map((match) => (
            <MatchHistoryRow
              key={match.id}
              match={match}
              productHandle={context.product.handle}
            />
          ))}
        </ol>
      ) : (
        <EmptyMatches
          launch={launch}
          isOwner={context.viewer.isOwner}
          productHandle={context.product.handle}
        />
      )}
      {launchSections.map(({ id, component: Section }) => (
        <RecoverableSlot
          key={id}
          className={LAUNCH_SECTION_SLOT_CLASS}
          contactAvailable={CLIENT_PROFILE.contactAvailable}
          contactHref={CONTACT_HREF}
        >
          <Section {...context} launch={sectionLaunch} />
          <span hidden data-product-launch-section-rendered="" />
        </RecoverableSlot>
      ))}
    </article>
  );
}
