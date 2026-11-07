import type { ComponentType } from 'react';

import { ULTRAS_PRICING_SECTION_TITLE } from '../components/ultras/ultras-messages.ts';
import { UltrasPricingSection } from '../components/ultras/ultras-pricing-section.tsx';

export interface PricingSection {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // ultras-subscriptionのUltras10・sponsorshipのスポンサー広告20
  readonly order: number;
  // 区画の見出し。部品が描く見出しと同じ文言にし、部品が描けない読み込み中と失敗の間はページがこの見出しを補う
  readonly title: string;
  // 自分でデータを取得し、自分の見出しを描く
  readonly component: ComponentType;
}

// 料金ページに並べる区画の登録箇所。各specが自分の区画を追記する
export const PRICING_SECTIONS: readonly PricingSection[] = Object.freeze([
  {
    id: 'ultras-subscription.ultras-pricing',
    order: 10,
    title: ULTRAS_PRICING_SECTION_TITLE,
    component: UltrasPricingSection,
  },
]);
