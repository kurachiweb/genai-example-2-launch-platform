import { cn } from '../../../lib/utilities/class-names.ts';
import {
  SPONSOR_LABEL_TEXT,
  type SponsorshipTier,
} from '../../../common-lib/sponsorship/sponsorship-tiers.ts';

export interface SponsorLabelProps {
  readonly tier: SponsorshipTier;
  readonly className?: string;
}

// Legendは受賞のゴールドと区別するため光沢感のある黒のグラデーションにし、どの配色でも暗い地に明るい文字を載せる
const TIER_CLASS_NAMES: Readonly<Record<SponsorshipTier, string>> =
  Object.freeze({
    legend:
      'bg-linear-120 from-(--legend-a) via-(--legend-b) to-(--legend-a) text-legend-foreground',
    gold: 'bg-linear-120 from-gold-strong via-gold to-gold-strong text-gold-foreground',
    silver: 'bg-silver text-gold-foreground',
  });

export function SponsorLabel({ tier, className }: SponsorLabelProps) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-bold',
        TIER_CLASS_NAMES[tier],
        className,
      )}
    >
      {SPONSOR_LABEL_TEXT}
    </span>
  );
}
