import { SponsoredAdCard } from './sponsored-ad-card.tsx';
import { SponsoredPlacementBoundary } from './sponsored-placement-boundary.tsx';
import type { SponsoredPlacementProps } from './sponsored-placement-types.ts';
import { SponsorshipApplyLink } from './sponsorship-apply-link.tsx';
import { sponsorshipPlacementLabel } from './sponsorship-messages.ts';
import { useSponsoredPlacements } from './use-sponsored-placements.ts';

function SilverRow({ viewer }: SponsoredPlacementProps) {
  const { silver } = useSponsoredPlacements();
  if (silver.length === 0 && !viewer.signedIn) {
    return null;
  }
  // トップページのフッター直上の置き場所は幅の器を持たないため、ページの本文と同じ最大幅と左右の余白をここで持つ
  return (
    <section
      aria-label={sponsorshipPlacementLabel('silver')}
      className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-4 pt-10"
    >
      {silver.length > 0 && (
        <ul className="flex min-w-0 flex-wrap gap-2">
          {silver.map((ad) => (
            <li key={ad.id} className="max-w-full min-w-0">
              <SponsoredAdCard ad={ad} />
            </li>
          ))}
        </ul>
      )}
      {viewer.signedIn && <SponsorshipApplyLink />}
    </section>
  );
}

export function SilverPlacement({ viewer }: SponsoredPlacementProps) {
  return (
    <SponsoredPlacementBoundary>
      <SilverRow viewer={viewer} />
    </SponsoredPlacementBoundary>
  );
}
