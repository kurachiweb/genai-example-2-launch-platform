import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';

import '../../styles.css';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { PRODUCT_PAGE_SECTIONS } from '../../composition/product-page-sections.ts';
import {
  ClientSponsoredPlacementsDocument,
  type ClientSponsoredPlacementsQuery,
} from '../../graphql/generated/graphql.ts';
import {
  breadcrumbs,
  productHeader,
  registered,
  renderProductPage,
  sectionElement,
  sidebar,
} from '../product-page/product-page-testing.tsx';
import type { ProductPageSection } from '../product-page/product-page-section-types.ts';
import {
  DESKTOP,
  goldRegion,
  legendRegion,
  MOBILE,
  rectOf,
  silverRegion,
  UNEXPECTED_MESSAGE,
  waitForPlacementsSettled,
} from './sponsored-page-testing.ts';
import {
  adNamesIn,
  adNamesOf,
  PLACEMENTS_LOAD_FAILURE,
  placementsOf,
} from './sponsored-placements-fixtures.ts';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const SPONSORSHIP_SECTIONS = PRODUCT_PAGE_SECTIONS.filter(({ id }) =>
  id.startsWith('sponsorship.'),
);

const RATING_TEXT = 'test.rating(Pitch-Notes・Pitch Notes・他者・自動更新オン)';
const REPORT_TEXT = 'test.report(Pitch-Notes・Pitch Notes・他者・自動更新オン)';
const MAIN_TEXT = 'test.main(Pitch-Notes・Pitch Notes・他者・自動更新オン)';

// 詳細ページの機能・評価・通報の区画の代わりに、同じ置き場所と順の値の区画を置く
const NEIGHBORS: readonly ProductPageSection[] = [
  registered('test.owner', 'aside', 10),
  registered('test.rating', 'aside', 20),
  registered('test.main', 'main', 20),
  registered('test.report', 'bottom', 10),
];

const respond = (placements: unknown) => {
  vi.mocked(executeGraphQL).mockImplementation(((document: unknown) =>
    document === ClientSponsoredPlacementsDocument
      ? Promise.resolve(placements)
      : Promise.reject(new Error('想定外の操作です。'))) as never);
};

const respondWith = (data: ClientSponsoredPlacementsQuery) => {
  respond({ ok: true, data });
};

const renderWith = async (sections: readonly ProductPageSection[]) => {
  const context = await renderProductPage({ sections, signedIn: false });
  await expect.element(productHeader()).toBeVisible();
  if (sections.some(({ id }) => id.startsWith('sponsorship.'))) {
    await waitForPlacementsSettled(context.queryClient);
  }
};

const measure = () => {
  const header = rectOf(productHeader().element());
  return {
    headerLeft: header.left,
    headerTop: header.top,
    headerWidth: header.width,
    pageBottom: document.documentElement.scrollHeight,
  };
};

const measureWithout = async (sections: readonly ProductPageSection[]) => {
  await renderWith(sections);
  const baseline = measure();
  await cleanup();
  return baseline;
};

beforeEach(() => {
  vi.mocked(executeGraphQL).mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  window.scrollTo(0, 0);
});

afterEach(async () => {
  applyColorScheme('light');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('プロダクト詳細ページの広告スペース', () => {
  test('画面幅1280pxでは、本文とサイドバーの上の全幅にLegend、サイドバーの評価の後にGoldの全件、本文の末尾の通報の後にSilverを、本文の列の器のまま描く', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
    respondWith(placementsOf({ legend: 2, gold: 3, silver: 2 }));

    await renderWith([...SPONSORSHIP_SECTIONS, ...NEIGHBORS]);

    await expect.element(legendRegion()).toBeVisible();
    const legend = rectOf(legendRegion().element());
    expect(legend.bottom).toBeLessThanOrEqual(
      rectOf(breadcrumbs().element()).top,
    );
    expect(legend.right).toBe(rectOf(sidebar().element()).right);
    expect(sidebar().element().contains(goldRegion().element())).toBe(true);
    expect(adNamesIn(goldRegion().getByRole('listitem').elements())).toEqual(
      adNamesOf('GOLD', 3),
    );
    expect(rectOf(goldRegion().element()).top).toBeGreaterThan(
      rectOf(sectionElement(RATING_TEXT)).bottom,
    );
    const report = rectOf(sectionElement(REPORT_TEXT));
    const silver = rectOf(silverRegion().element());
    expect(silver.top).toBeGreaterThan(report.bottom);
    expect(silver.left).toBe(report.left);
    expect(silver.width).toBe(report.width);
    expect(silver.top - report.bottom).toBe(
      report.top - rectOf(sectionElement(MAIN_TEXT)).bottom,
    );
  });

  test.each([
    ['画面幅1280px', DESKTOP],
    ['画面幅375px', MOBILE],
  ])(
    '%sで広告が0件なら、未ログインの閲覧者には何も描かず、サイドバーと空の列と間隔を残さない',
    async (_label, viewport) => {
      await page.viewport(viewport.width, viewport.height);
      const baseline = await measureWithout([]);
      respondWith(placementsOf({}));

      await renderWith(SPONSORSHIP_SECTIONS);

      expect(
        page.getByRole('region', { name: /スポンサー広告$/u }).elements(),
      ).toHaveLength(0);
      expect(sidebar().elements()).toHaveLength(0);
      expect(measure()).toStrictEqual(baseline);
    },
  );

  test('広告の取得に失敗しても、失敗の表示を出さず、他の区画とページを広告が無いときと同じ配置で表示する', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
    const baseline = await measureWithout(NEIGHBORS);
    respond(PLACEMENTS_LOAD_FAILURE);

    await renderWith([...SPONSORSHIP_SECTIONS, ...NEIGHBORS]);

    await expect.element(page.getByText(REPORT_TEXT)).toBeVisible();
    expect(page.getByText(UNEXPECTED_MESSAGE).elements()).toHaveLength(0);
    expect(page.getByRole('alert').elements()).toHaveLength(0);
    expect(measure()).toStrictEqual(baseline);
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、3つのティアの広告を描いた詳細ページのaxeの違反が0件である',
    async (scheme) => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      applyColorScheme(scheme);
      respondWith(placementsOf({ legend: 2, gold: 3, silver: 2 }));

      await renderWith([...SPONSORSHIP_SECTIONS, ...NEIGHBORS]);

      await expect.element(silverRegion()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
