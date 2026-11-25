import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import type { RouterContext } from '../../../lib/start/router-context.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  ClientSponsoredPlacementsDocument,
  type ClientSponsoredPlacementsQuery,
} from '../../graphql/generated/graphql.ts';
import { LegendPlacement } from './legend-placement.tsx';
import {
  adNamesIn,
  adNamesOf,
  PLACEMENTS_LOAD_FAILURE,
  placementsOf,
} from './sponsored-placements-fixtures.ts';
import { SPONSORSHIP_APPLY_LINK_LABEL } from './sponsorship-messages.ts';
import { sponsoredPlacementsQueryOptions } from './use-sponsored-placements.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const REGION_NAME = 'Legendスポンサー広告';

const OTHER_CONTENT = 'ページの他の内容';

const VIEWPORT_HEIGHT = 900;

const respond = (result: unknown) => {
  executeGraphQL.mockImplementation((document: unknown) =>
    document === ClientSponsoredPlacementsDocument
      ? Promise.resolve(result)
      : Promise.reject(new Error('想定外の操作です。')),
  );
};

const respondWith = (data: ClientSponsoredPlacementsQuery) => {
  respond({ ok: true, data });
};

const placementCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientSponsoredPlacementsDocument,
  );

const region = () => page.getByRole('region', { name: REGION_NAME });

const renderLegend = async (): Promise<RouterContext> => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <>
      <div data-testid="placement-host">
        <LegendPlacement />
      </div>
      <p>{OTHER_CONTENT}</p>
    </>,
    { context },
  );
  return context;
};

const waitForSettled = async (context: RouterContext) => {
  await vi.waitFor(() => {
    expect(['success', 'error']).toContain(
      context.queryClient.getQueryState(
        sponsoredPlacementsQueryOptions().queryKey,
      )?.status,
    );
  });
  // 取得の結果を受けた描き直し(失敗ならエラーの境界への伝播)を終えてから確かめる
  for (let frame = 0; frame < 2; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
};

const expectNothingDrawn = async (context: RouterContext) => {
  await waitForSettled(context);
  await expect.element(page.getByText(OTHER_CONTENT)).toBeVisible();
  expect(placementCalls()).toHaveLength(1);
  expect(page.getByTestId('placement-host').element().childElementCount).toBe(
    0,
  );
  expect(page.getByRole('link').elements()).toHaveLength(0);
  expect(page.getByRole('button').elements()).toHaveLength(0);
  expect(page.getByRole('alert').elements()).toHaveLength(0);
};

const columnCountOf = (list: Element): number =>
  getComputedStyle(list).gridTemplateColumns.split(' ').length;

afterEach(() => {
  executeGraphQL.mockReset();
  applyColorScheme('light');
});

describe('LegendPlacement', () => {
  test('名前付きの領域にLegendの広告を全件、取得した順に一覧で並べ、申込の導線を出さない', async () => {
    respondWith(placementsOf({ legend: 5, gold: 2, silver: 2 }));

    await renderLegend();

    await expect.element(region()).toBeVisible();
    const items = region().getByRole('listitem').elements();
    expect(adNamesIn(items)).toEqual(adNamesOf('LEGEND', 5));
    expect(
      page.getByRole('link', { name: SPONSORSHIP_APPLY_LINK_LABEL }).elements(),
    ).toHaveLength(0);
  });

  test.each<[number, number]>([
    [375, 2],
    [767, 2],
    [768, 3],
    [1279, 3],
    [1280, 4],
    [1600, 4],
  ])(
    '画面幅%ipxでは%i列のグリッドで並べ、横にはみ出さない',
    async (width, columns) => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      respondWith(placementsOf({ legend: 8 }));

      await renderLegend();

      await expect.element(region()).toBeVisible();
      const list = region().getByRole('list').element();
      expect(columnCountOf(list)).toBe(columns);
      expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        window.innerWidth,
      );
    },
  );

  test('親がグリッドでも、行の全幅を占める', async () => {
    await page.viewport(1280, VIEWPORT_HEIGHT);
    respondWith(placementsOf({ legend: 2 }));

    await renderInRouter(
      <div data-testid="parent-grid" className="grid grid-cols-4 gap-3">
        <div>先に並ぶ項目</div>
        <LegendPlacement />
      </div>,
    );

    await expect.element(region()).toBeVisible();
    const parent = page.getByTestId('parent-grid').element();
    const section = region().element();
    expect(section.getBoundingClientRect().width).toBe(
      parent.getBoundingClientRect().width,
    );
    expect(section.getBoundingClientRect().left).toBe(
      parent.getBoundingClientRect().left,
    );
  });

  test('広告が0件なら、閲覧者の状態によらず何も描かない', async () => {
    respondWith(placementsOf({ gold: 2, silver: 2 }));

    const context = await renderLegend();

    await expectNothingDrawn(context);
  });

  test('取得に失敗したら、何も描かず、失敗の表示も出さずにページの他の内容を残す', async () => {
    respond(PLACEMENTS_LOAD_FAILURE);

    const context = await renderLegend();

    await expectNothingDrawn(context);
  });

  test.each(COLOR_SCHEMES)('%sの配色でaxeの違反が0件である', async (scheme) => {
    applyColorScheme(scheme);
    respondWith(placementsOf({ legend: 4 }));

    await renderLegend();

    await expect.element(region()).toBeVisible();
    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
