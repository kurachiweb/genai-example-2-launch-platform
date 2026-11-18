import { useSyncExternalStore } from 'react';

import { GoldAdStack } from './gold-ad-stack.tsx';
import { goldInsertTracker } from './gold-insert-tracker.ts';
import { SponsoredPlacementBoundary } from './sponsored-placement-boundary.tsx';
import type { SponsoredPlacementProps } from './sponsored-placement-types.ts';
import { useSponsoredPlacements } from './use-sponsored-placements.ts';

function GoldColumns({ viewer }: SponsoredPlacementProps) {
  const { gold } = useSponsoredPlacements();
  const insertedCount = useSyncExternalStore<number | null>(
    goldInsertTracker.subscribe,
    goldInsertTracker.getSnapshot,
    goldInsertTracker.getServerSnapshot,
  );
  return (
    <>
      <GoldAdStack
        ads={gold}
        signedIn={viewer.signedIn}
        shownOn="wide"
        className="lg:sticky lg:top-20"
      />
      {insertedCount !== null && (
        <GoldAdStack
          ads={gold.slice(insertedCount)}
          signedIn={viewer.signedIn}
          shownOn="narrow"
        />
      )}
    </>
  );
}

// 1024px以上は横の列に全件を、未満は一覧の差し込みが描いた数より後の余りを一覧の下に並べる。
// 差し込みの数は描画の後に決まるため、余りはサーバーで描かず復元の後に描く(一覧の下のため上の内容の位置を動かさない)
export function GoldListPlacement({ viewer }: SponsoredPlacementProps) {
  return (
    <SponsoredPlacementBoundary>
      <GoldColumns viewer={viewer} />
    </SponsoredPlacementBoundary>
  );
}
