import { GoldAdStack } from './gold-ad-stack.tsx';
import { SponsoredPlacementBoundary } from './sponsored-placement-boundary.tsx';
import type { SponsoredPlacementProps } from './sponsored-placement-types.ts';
import { useSponsoredPlacements } from './use-sponsored-placements.ts';

function GoldSidebarStack({ viewer }: SponsoredPlacementProps) {
  const { gold } = useSponsoredPlacements();
  return <GoldAdStack ads={gold} signedIn={viewer.signedIn} />;
}

// プロダクト詳細ページには一覧への差し込みが無いため、全ての幅でサイドバーの位置に全件を並べる。追従はサイドバーが持つ
export function GoldSidebarPlacement({ viewer }: SponsoredPlacementProps) {
  return (
    <SponsoredPlacementBoundary>
      <GoldSidebarStack viewer={viewer} />
    </SponsoredPlacementBoundary>
  );
}
