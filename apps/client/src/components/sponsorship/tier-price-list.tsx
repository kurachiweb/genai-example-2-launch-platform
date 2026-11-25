import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import {
  SPONSORSHIP_TIER_LABELS,
  SPONSORSHIP_TIERS,
  type SponsorshipTier,
} from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import type { ClientSponsorshipOfferQuery } from '../../graphql/generated/graphql.ts';
import { toSponsorshipTier } from '../../graphql/sponsorship.ts';
import { SponsorLabel } from './sponsor-label.tsx';
import {
  SPONSORSHIP_PRICE_PER_DAY_SUFFIX,
  SPONSORSHIP_PRICE_UNAVAILABLE_MESSAGE,
  SPONSORSHIP_TIER_CONTENTS,
  SPONSORSHIP_TIER_POSITIONS,
} from './sponsorship-messages.ts';

type TierOffers = ClientSponsorshipOfferQuery['sponsorshipOffer']['tiers'];

export interface TierPriceListProps {
  readonly tiers: TierOffers;
}

const unitAmountOf = (
  tiers: TierOffers,
  tier: SponsorshipTier,
): number | null =>
  tiers.find((offer) => toSponsorshipTier(offer.tier) === tier)?.unitPrice
    ?.amount ?? null;

// 結果に無いティアと単価がnullのティアは価格を照会できなかったものとして扱い、説明は全てのティアで示す
export function TierPriceList({ tiers }: TierPriceListProps) {
  return (
    <ul className="grid gap-4 sm:grid-cols-3">
      {SPONSORSHIP_TIERS.map((tier) => {
        const amount = unitAmountOf(tiers, tier);
        return (
          <li
            key={tier}
            className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground"
          >
            <div className="flex items-center gap-2">
              <SponsorLabel tier={tier} />
              <h3 className="text-lg font-bold">
                {SPONSORSHIP_TIER_LABELS[tier]}
              </h3>
            </div>
            <p className="text-xl font-bold">
              {amount === null ? (
                SPONSORSHIP_PRICE_UNAVAILABLE_MESSAGE
              ) : (
                <>
                  <MoneyText amount={amount} />
                  {SPONSORSHIP_PRICE_PER_DAY_SUFFIX}
                </>
              )}
            </p>
            <p className="text-sm">{SPONSORSHIP_TIER_POSITIONS[tier]}</p>
            <p className="text-sm text-muted-foreground">
              {SPONSORSHIP_TIER_CONTENTS[tier]}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
