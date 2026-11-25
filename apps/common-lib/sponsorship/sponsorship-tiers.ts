export const SPONSORSHIP_TIERS = Object.freeze([
  'legend',
  'gold',
  'silver',
] as const);

export type SponsorshipTier = (typeof SPONSORSHIP_TIERS)[number];

export const SPONSORSHIP_TIER_LABELS: Readonly<
  Record<SponsorshipTier, string>
> = Object.freeze({
  legend: 'Legend',
  gold: 'Gold',
  silver: 'Silver',
});

export const SPONSORSHIP_PRICE_LOOKUP_KEYS: Readonly<
  Record<SponsorshipTier, string>
> = Object.freeze({
  legend: 'sponsorship_legend_daily',
  gold: 'sponsorship_gold_daily',
  silver: 'sponsorship_silver_daily',
});

export const SPONSOR_LABEL_TEXT = 'スポンサー';
