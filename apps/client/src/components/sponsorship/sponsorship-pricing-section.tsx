import { useSuspenseQuery } from '@tanstack/react-query';

import { sponsorshipOfferQueryOptions } from '../../graphql/sponsorship.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { SponsorshipApplicationForm } from './sponsorship-application-form.tsx';
import {
  SPONSORSHIP_PRICING_SECTION_ID,
  SPONSORSHIP_PRICING_SECTION_TITLE,
} from './sponsorship-messages.ts';
import { TierPriceList } from './tier-price-list.tsx';

// 区画自身が価格と申込の対象を取得し、最初の取得の失敗だけを区画のエラーの境界へ投げる。見出しのidは申込の導線のページ内のアンカーを兼ねる
export function SponsorshipPricingSection() {
  const viewer = useViewer();
  const { data } = useSuspenseQuery(sponsorshipOfferQueryOptions(viewer));
  return (
    <section
      aria-labelledby={SPONSORSHIP_PRICING_SECTION_ID}
      className="flex flex-col gap-6"
    >
      <h2
        id={SPONSORSHIP_PRICING_SECTION_ID}
        className="scroll-mt-20 text-2xl font-extrabold tracking-tight"
      >
        {SPONSORSHIP_PRICING_SECTION_TITLE}
      </h2>
      <TierPriceList tiers={data.sponsorshipOffer.tiers} />
      <SponsorshipApplicationForm offer={data.sponsorshipOffer} />
    </section>
  );
}
