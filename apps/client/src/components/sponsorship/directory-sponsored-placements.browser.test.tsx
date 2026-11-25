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
import {
  DIRECTORY_LIST_INSERTS,
  DIRECTORY_PAGE_SECTIONS,
} from '../../composition/directory-sections.ts';
import {
  ClientDirectoryCategoriesDocument,
  ClientDirectoryDocument,
  ClientSponsoredPlacementsDocument,
  type ClientSponsoredPlacementsQuery,
} from '../../graphql/generated/graphql.ts';
import {
  articleOf,
  articles,
  CATEGORIES_RESULT,
  directoryOf,
  itemsFrom,
  launchCtaHeading,
  listRegion,
  okDirectory,
  pageHeading,
  renderDirectory,
  type RenderDirectoryOptions,
  textOf,
} from '../directory/directory-page-testing.tsx';
import {
  AD_LINK_NAME,
  DESKTOP,
  displayOf,
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

const ITEM_COUNT = 4;

const respond = (placements: unknown) => {
  vi.mocked(executeGraphQL).mockImplementation(((document: unknown) => {
    if (document === ClientDirectoryDocument) {
      return Promise.resolve(
        okDirectory(directoryOf({ items: itemsFrom(1, ITEM_COUNT) })),
      );
    }
    if (document === ClientDirectoryCategoriesDocument) {
      return Promise.resolve(CATEGORIES_RESULT);
    }
    if (document === ClientSponsoredPlacementsDocument) {
      return Promise.resolve(placements);
    }
    throw new Error('想定していない操作が実行されました。');
  }) as never);
};

const respondWith = (data: ClientSponsoredPlacementsQuery) => {
  respond({ ok: true, data });
};

// 本specの登録だけを持つディレクトリを描き、広告の取得の結果を受けた描き直しまで待つ
const renderWithPlacements = async (
  options: RenderDirectoryOptions = {
    sections: DIRECTORY_PAGE_SECTIONS,
    inserts: DIRECTORY_LIST_INSERTS,
  },
) => {
  const router = await renderDirectory(options);
  await expect.element(articleOf('プロダクト1')).toBeVisible();
  if (options.sections !== undefined && options.sections.length > 0) {
    await waitForPlacementsSettled(router.options.context.queryClient);
  }
  return router;
};

const listItems = () =>
  page
    .elementLocator(articleOf('プロダクト1').element().closest('ul') as Element)
    .getByRole('listitem')
    .elements();

const measure = () => ({
  headingTop: rectOf(pageHeading().element()).top,
  listLeft: rectOf(listRegion().element()).left,
  listWidth: rectOf(listRegion().element()).width,
  lastItemBottom: rectOf(articleOf('プロダクト4').element()).bottom,
  ctaTop: rectOf(launchCtaHeading().element().closest('section')).top,
  pageBottom: document.documentElement.scrollHeight,
});

const measureWithoutPlacements = async () => {
  respond(PLACEMENTS_LOAD_FAILURE);
  await renderWithPlacements({ sections: [], inserts: [] });
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

describe('ディレクトリの広告スペース', () => {
  test('画面幅1280pxでは、見出しの上にLegend、一覧の横の列にGoldの全件、ローンチ予約への導線の下にSilverを、ページの本文と同じ幅の器の中に描く', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
    respondWith(placementsOf({ legend: 2, gold: 3, silver: 2 }));

    await renderWithPlacements();

    await expect.element(legendRegion()).toBeVisible();
    const legend = rectOf(legendRegion().element());
    expect(legend.bottom).toBeLessThanOrEqual(
      rectOf(pageHeading().element()).top,
    );
    expect(adNamesIn(goldRegion().getByRole('listitem').elements())).toEqual(
      adNamesOf('GOLD', 3),
    );
    expect(rectOf(goldRegion().element()).left).toBeGreaterThan(
      rectOf(articleOf('プロダクト1').element()).right,
    );
    const silver = rectOf(silverRegion().element());
    const ctaBottom = rectOf(
      launchCtaHeading().element().closest('section'),
    ).bottom;
    expect(silver.top).toBeGreaterThan(ctaBottom);
    expect(silver.left).toBe(legend.left);
    expect(silver.width).toBe(legend.width);
    expect(getComputedStyle(silverRegion().element()).paddingLeft).toBe('0px');
    expect(goldRegion().elements()).toHaveLength(1);
  });

  test('画面幅1280pxでは、一覧への差し込みの項目を描かず、一覧の項目の間隔をそろえる', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
    respondWith(placementsOf({ gold: 3 }));

    await renderWithPlacements();

    expect(listItems()).toHaveLength(ITEM_COUNT);
    expect(
      listRegion().getByRole('link', { name: AD_LINK_NAME }).elements(),
    ).toHaveLength(0);
    const gaps = [1, 2, 3].map(
      (n) =>
        rectOf(articleOf(`プロダクト${String(n + 1)}`).element()).top -
        rectOf(articleOf(`プロダクト${String(n)}`).element()).bottom,
    );
    expect(new Set(gaps).size).toBe(1);
  });

  test('画面幅375pxでは、一覧の2件ごとにGoldを1枚差し込み、余りを一覧の下に並べる', async () => {
    await page.viewport(MOBILE.width, MOBILE.height);
    respondWith(placementsOf({ gold: 3 }));

    await renderWithPlacements();

    await vi.waitFor(() => {
      expect(adNamesIn(goldRegion().getByRole('listitem').elements())).toEqual(
        adNamesOf('GOLD', 3).slice(2),
      );
    });
    const insertedLinks = listRegion()
      .getByRole('link', { name: AD_LINK_NAME })
      .elements();
    expect(insertedLinks).toHaveLength(2);
    expect(listItems()).toHaveLength(ITEM_COUNT + 2);
    expect(rectOf(goldRegion().element()).top).toBeGreaterThan(
      rectOf(articleOf('プロダクト4').element()).bottom,
    );
  });

  test('画面幅375pxで全てのGoldを一覧に差し込んだら、未ログインの閲覧者には空の横の列と間隔を残さない', async () => {
    await page.viewport(MOBILE.width, MOBILE.height);
    respondWith(placementsOf({ gold: 2 }));
    const router = await renderDirectory({ inserts: DIRECTORY_LIST_INSERTS });
    await expect.element(articleOf('プロダクト1')).toBeVisible();
    await waitForPlacementsSettled(router.options.context.queryClient);
    const listToCta =
      rectOf(launchCtaHeading().element().closest('section')).top -
      rectOf(listRegion().element()).bottom;
    await cleanup();

    await renderWithPlacements();

    expect(
      listRegion().getByRole('link', { name: AD_LINK_NAME }).elements(),
    ).toHaveLength(2);
    expect(goldRegion().elements()).toHaveLength(0);
    expect(displayOf('[data-directory-aside]')).toBe('none');
    expect(
      rectOf(launchCtaHeading().element().closest('section')).top -
        rectOf(listRegion().element()).bottom,
    ).toBe(listToCta);
  });

  test.each([
    ['画面幅1280px', DESKTOP],
    ['画面幅375px', MOBILE],
  ])(
    '%sで広告が0件なら、未ログインの閲覧者には何も描かず、空の枠・列・一覧の項目と間隔を残さない',
    async (_label, viewport) => {
      await page.viewport(viewport.width, viewport.height);
      const baseline = await measureWithoutPlacements();
      respondWith(placementsOf({}));

      await renderWithPlacements();

      expect(
        page.getByRole('region', { name: /スポンサー広告$/u }).elements(),
      ).toHaveLength(0);
      expect(listItems()).toHaveLength(ITEM_COUNT);
      expect(measure()).toStrictEqual(baseline);
    },
  );

  test.each([
    ['画面幅1280px', DESKTOP],
    ['画面幅375px', MOBILE],
  ])(
    '%sで広告の取得に失敗しても、失敗の表示を出さず、一覧と検索欄を広告が無いときと同じ配置で表示する',
    async (_label, viewport) => {
      await page.viewport(viewport.width, viewport.height);
      const baseline = await measureWithoutPlacements();
      respond(PLACEMENTS_LOAD_FAILURE);

      await renderWithPlacements();

      expect(articles().all()).toHaveLength(ITEM_COUNT);
      expect(textOf(UNEXPECTED_MESSAGE).elements()).toHaveLength(0);
      expect(page.getByRole('alert').elements()).toHaveLength(0);
      expect(measure()).toStrictEqual(baseline);
      expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、3つのティアの広告を描いたディレクトリのaxeの違反が0件である',
    async (scheme) => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      applyColorScheme(scheme);
      respondWith(placementsOf({ legend: 2, gold: 3, silver: 2 }));

      await renderWithPlacements();

      await expect.element(silverRegion()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
