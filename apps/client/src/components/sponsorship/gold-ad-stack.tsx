import { cn } from '../../../lib/utilities/class-names.ts';
import type { SponsoredAdFieldsFragment } from '../../graphql/generated/graphql.ts';
import { SponsoredAdCard } from './sponsored-ad-card.tsx';
import { SponsorshipApplyLink } from './sponsorship-apply-link.tsx';
import { sponsorshipPlacementLabel } from './sponsorship-messages.ts';
import { VIEWPORT_ONLY_ATTRIBUTES } from './viewport-only.ts';

export interface GoldAdStackProps {
  readonly ads: readonly SponsoredAdFieldsFragment[];
  readonly signedIn: boolean;
  // 画面幅1024px以上(wide)か未満(narrow)だけで表示する。省略すると全ての幅で表示する
  readonly shownOn?: 'wide' | 'narrow';
  readonly className?: string;
}

const SHOWN_ON_CLASSES = Object.freeze({
  wide: 'hidden lg:flex',
  narrow: 'lg:hidden',
});

// 1024px以上は置き場所の列の幅によらず280pxにして列の先頭に寄せ、未満は置き場所の幅いっぱいに並べる
export function GoldAdStack({
  ads,
  signedIn,
  shownOn,
  className,
}: GoldAdStackProps) {
  if (ads.length === 0 && !signedIn) {
    return null;
  }
  return (
    <section
      aria-label={sponsorshipPlacementLabel('gold')}
      className={cn(
        'flex w-full flex-col gap-3 lg:w-70',
        shownOn !== undefined && SHOWN_ON_CLASSES[shownOn],
        className,
      )}
      {...(shownOn === undefined ? {} : VIEWPORT_ONLY_ATTRIBUTES[shownOn])}
    >
      {ads.length > 0 && (
        <ul className="flex flex-col gap-3">
          {ads.map((ad) => (
            <li key={ad.id} className="min-w-0">
              <SponsoredAdCard ad={ad} />
            </li>
          ))}
        </ul>
      )}
      {signedIn && <SponsorshipApplyLink className="w-full justify-center" />}
    </section>
  );
}
