import { describe, expect, test, vi } from 'vitest';

import { PRICING_SECTIONS } from '../../composition/pricing-sections.ts';
import { SponsorshipPricingSection } from '../sponsorship/sponsorship-pricing-section.tsx';
import { UltrasPricingSection } from './ultras-pricing-section.tsx';

// 実行の関数はサーバー専用の処理を読み込むため、登録箇所の部品を読み込むテストでは差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

const componentOf = (id: string) =>
  PRICING_SECTIONS.find((section) => section.id === id)?.component;

describe('料金ページの区画の登録箇所', () => {
  test('区画にはultras-subscriptionのUltras(10)・sponsorshipのスポンサー広告(20)を登録し、titleは各区画が描く見出しと同じ文言にする', () => {
    expect(
      PRICING_SECTIONS.map(({ id, order, title }) => ({ id, order, title })),
    ).toStrictEqual([
      { id: 'ultras-subscription.ultras-pricing', order: 10, title: 'Ultras' },
      {
        id: 'sponsorship.sponsorship-pricing',
        order: 20,
        title: 'スポンサー広告',
      },
    ]);
    expect(componentOf('ultras-subscription.ultras-pricing')).toBe(
      UltrasPricingSection,
    );
    expect(componentOf('sponsorship.sponsorship-pricing')).toBe(
      SponsorshipPricingSection,
    );
  });

  test('区画のidは重複せず`<spec名>.<名詞句>`の形で、orderは重複しない有限の数である', () => {
    const ids = PRICING_SECTIONS.map(({ id }) => id);
    const orders = PRICING_SECTIONS.map(({ order }) => order);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => SECTION_ID_PATTERN.test(id))).toBe(true);
    expect(new Set(orders).size).toBe(orders.length);
    expect(orders.every((order) => Number.isFinite(order))).toBe(true);
  });
});
