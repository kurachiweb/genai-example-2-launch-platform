import { SponsoredAdCard } from './sponsored-ad-card.tsx';
import { SponsoredPlacementBoundary } from './sponsored-placement-boundary.tsx';
import { sponsorshipPlacementLabel } from './sponsorship-messages.ts';
import { useSponsoredPlacements } from './use-sponsored-placements.ts';

function LegendGrid() {
  const { legend } = useSponsoredPlacements();
  if (legend.length === 0) {
    return null;
  }
  return (
    <section
      aria-label={sponsorshipPlacementLabel('legend')}
      className="col-span-full min-w-0"
    >
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {legend.map((ad) => (
          <li key={ad.id} className="min-w-0">
            <SponsoredAdCard ad={ad} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// Legendには申込の導線を置かないため閲覧者の状態を受け取らず、0件なら何も描かない
export function LegendPlacement() {
  return (
    <SponsoredPlacementBoundary>
      <LegendGrid />
    </SponsoredPlacementBoundary>
  );
}
