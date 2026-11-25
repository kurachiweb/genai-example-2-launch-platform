import { cn } from '../../../lib/utilities/class-names.ts';
import { SponsoredAdCard } from './sponsored-ad-card.tsx';
import { SponsoredPlacementBoundary } from './sponsored-placement-boundary.tsx';
import type { SponsoredPlacementProps } from './sponsored-placement-types.ts';
import { SponsorshipApplyLink } from './sponsorship-apply-link.tsx';
import { sponsorshipPlacementLabel } from './sponsorship-messages.ts';
import { useSponsoredPlacements } from './use-sponsored-placements.ts';

export interface SilverPlacementProps extends SponsoredPlacementProps {
  // 置き場所が幅の器を持たないページだけが、最大幅と余白を渡す
  readonly className?: string;
}

function SilverRow({ viewer, className }: SilverPlacementProps) {
  const { silver } = useSponsoredPlacements();
  if (silver.length === 0 && !viewer.signedIn) {
    return null;
  }
  return (
    <section
      aria-label={sponsorshipPlacementLabel('silver')}
      className={cn('flex flex-wrap items-center gap-2', className)}
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

export function SilverPlacement({ viewer, className }: SilverPlacementProps) {
  return (
    <SponsoredPlacementBoundary>
      <SilverRow viewer={viewer} className={className} />
    </SponsoredPlacementBoundary>
  );
}
