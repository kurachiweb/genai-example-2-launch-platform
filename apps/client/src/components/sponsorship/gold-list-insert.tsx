import { useEffect } from 'react';

import { goldInsertTracker } from './gold-insert-tracker.ts';
import { SponsoredAdCard } from './sponsored-ad-card.tsx';
import { SponsoredPlacementBoundary } from './sponsored-placement-boundary.tsx';
import { useSponsoredPlacements } from './use-sponsored-placements.ts';

export interface GoldListInsertProps {
  readonly position: number;
}

function GoldInsertCard({ position }: GoldListInsertProps) {
  const { gold } = useSponsoredPlacements();
  const ad = gold[position - 1];
  const drawn = ad !== undefined;
  // サーバーの描画では効果が動かず、リクエストをまたいで数が残らない
  useEffect(() => {
    if (!drawn) {
      return;
    }
    return goldInsertTracker.register(position);
  }, [drawn, position]);
  if (ad === undefined) {
    return null;
  }
  return (
    <div className="lg:hidden">
      <SponsoredAdCard ad={ad} />
    </div>
  );
}

// 1024px未満の一覧の項目の間に、position番目のGoldの広告を描く。ページが一覧の項目の要素を置くため、項目の要素を描かない
export function GoldListInsert({ position }: GoldListInsertProps) {
  return (
    <SponsoredPlacementBoundary>
      <GoldInsertCard position={position} />
    </SponsoredPlacementBoundary>
  );
}
