import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import type {
  ClientSponsorshipOfferQuery,
  SponsorshipTier,
} from '../../graphql/generated/graphql.ts';
import { TierPriceList } from './tier-price-list.tsx';

// 実行の関数はサーバー専用の処理を読み込むため、取得の補助を読み込む部品のテストでは差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

type TierOffers = ClientSponsorshipOfferQuery['sponsorshipOffer']['tiers'];

const NEW_YORK_EN: DisplayPreferences = {
  timeZone: 'America/New_York',
  locale: 'en-US',
};

const SPONSOR_LABEL = 'スポンサー';
const PRICE_UNAVAILABLE = '現在表示できません';

const EXPECTED_TIERS = [
  {
    name: 'Legend',
    price: '$50.00/日',
    position: '各ページの上部に大きく表示',
    contents: 'ロゴ・名称・タグライン',
  },
  {
    name: 'Gold',
    price: '$20.00/日',
    position: 'メインコンテンツの横と一覧の間に表示',
    contents: 'ロゴ・名称・タグライン',
  },
  {
    name: 'Silver',
    price: '$5.50/日',
    position: 'ページの下部に表示',
    contents: 'ロゴ・名称',
  },
] as const;

const offerOf = (
  tier: SponsorshipTier,
  amount: number | null,
): TierOffers[number] => ({
  tier,
  unitPrice: amount === null ? null : { amount, currency: 'usd' },
});

const ALL_PRICED: TierOffers = [
  offerOf('LEGEND', 5000),
  offerOf('GOLD', 2000),
  offerOf('SILVER', 550),
];

const renderList = (tiers: TierOffers) =>
  render(
    <DisplayPreferencesProvider initial={NEW_YORK_EN}>
      <main>
        <TierPriceList tiers={tiers} />
      </main>
    </DisplayPreferencesProvider>,
  );

const tierItems = () => page.getByRole('listitem').elements();

const tierItemNamed = (name: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name }) });

beforeEach(async () => {
  await emulateBrowserDisplay(NEW_YORK_EN);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('TierPriceList', () => {
  test('Legend・Gold・Silverの順に、広告のラベルとティアの表示名・「<金額>/日」の単価・表示位置・表示内容を示す', async () => {
    await renderList(ALL_PRICED);

    await expect.element(tierItemNamed('Legend')).toBeVisible();
    expect(
      page
        .getByRole('heading', { level: 3 })
        .elements()
        .map((heading) => heading.textContent),
    ).toStrictEqual(EXPECTED_TIERS.map(({ name }) => name));
    expect(tierItems()).toHaveLength(EXPECTED_TIERS.length);
    for (const { name, price, position, contents } of EXPECTED_TIERS) {
      const item = tierItemNamed(name);
      await expect
        .element(item.getByText(SPONSOR_LABEL, { exact: true }))
        .toBeVisible();
      await expect
        .element(item.getByText(price, { exact: true }))
        .toBeVisible();
      await expect
        .element(item.getByText(position, { exact: true }))
        .toBeVisible();
      await expect
        .element(item.getByText(contents, { exact: true }))
        .toBeVisible();
    }
  });

  test('サーバーが返す順によらず、Legend・Gold・Silverの順に並べる', async () => {
    await renderList([...ALL_PRICED].reverse());

    await expect.element(tierItemNamed('Silver')).toBeVisible();
    expect(
      page
        .getByRole('heading', { level: 3 })
        .elements()
        .map((heading) => heading.textContent),
    ).toStrictEqual(['Legend', 'Gold', 'Silver']);
  });

  test('単価を照会できないティアは、単価の位置に「現在表示できません」を示し、他のティアの単価は示し続ける', async () => {
    await renderList([
      offerOf('LEGEND', 5000),
      offerOf('GOLD', null),
      offerOf('SILVER', 550),
    ]);

    await expect
      .element(
        tierItemNamed('Gold').getByText(PRICE_UNAVAILABLE, { exact: true }),
      )
      .toBeVisible();
    expect(tierItemNamed('Gold').element().textContent).not.toContain('$');
    await expect
      .element(tierItemNamed('Legend').getByText('$50.00/日', { exact: true }))
      .toBeVisible();
    await expect
      .element(tierItemNamed('Silver').getByText('$5.50/日', { exact: true }))
      .toBeVisible();
    await expect
      .element(
        tierItemNamed('Gold').getByText(EXPECTED_TIERS[1].position, {
          exact: true,
        }),
      )
      .toBeVisible();
  });

  test('価格の取得に失敗して全てのティアの単価がnullなら、3つのティアとも単価の位置に「現在表示できません」を示し、説明は示し続ける', async () => {
    await renderList([
      offerOf('LEGEND', null),
      offerOf('GOLD', null),
      offerOf('SILVER', null),
    ]);

    await expect.element(tierItemNamed('Legend')).toBeVisible();
    expect(
      page.getByText(PRICE_UNAVAILABLE, { exact: true }).elements(),
    ).toHaveLength(3);
    expect(document.body.textContent).not.toContain('/日');
    for (const { name, position, contents } of EXPECTED_TIERS) {
      await expect
        .element(tierItemNamed(name).getByText(position, { exact: true }))
        .toBeVisible();
      await expect
        .element(tierItemNamed(name).getByText(contents, { exact: true }))
        .toBeVisible();
    }
  });

  test('サーバーの結果に無いティアは、単価の位置に「現在表示できません」を示す', async () => {
    await renderList([offerOf('LEGEND', 5000)]);

    await expect
      .element(
        tierItemNamed('Silver').getByText(PRICE_UNAVAILABLE, { exact: true }),
      )
      .toBeVisible();
    await expect
      .element(
        tierItemNamed('Gold').getByText(PRICE_UNAVAILABLE, { exact: true }),
      )
      .toBeVisible();
    expect(tierItems()).toHaveLength(3);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('単価を示す一覧で、アクセシビリティの検査の違反が0件', async () => {
      await renderList(ALL_PRICED);
      await expect.element(tierItemNamed('Silver')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('単価を照会できない一覧で、アクセシビリティの検査の違反が0件', async () => {
      await renderList([
        offerOf('LEGEND', null),
        offerOf('GOLD', null),
        offerOf('SILVER', null),
      ]);
      await expect.element(tierItemNamed('Silver')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
