import { createFileRoute } from '@tanstack/react-router';

import { PricingPage } from '../components/ultras/pricing-page.tsx';
import { PRICING_SECTIONS } from '../composition/pricing-sections.ts';
import { buildPricingHead } from '../head/page-heads.ts';

// 登録された区画が自分でデータを取得するため、ページのloaderを持たない
export const Route = createFileRoute('/pricing')({
  head: () => buildPricingHead(),
  component: PricingRoute,
});

function PricingRoute() {
  return <PricingPage sections={PRICING_SECTIONS} />;
}
