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
import { renderPlacementsOnServer } from './render-placements-on-server.tsx';
import { GoldSidebarPlacement } from './gold-sidebar-placement.tsx';
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

const REGION_NAME = 'Goldスポンサー広告';

const OTHER_CONTENT = 'ページの他の内容';

const VIEWPORT_HEIGHT = 900;

const STACK_WIDTH_PX = 280;

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

const applyLink = () =>
  page.getByRole('link', { name: SPONSORSHIP_APPLY_LINK_LABEL });

const host = () => page.getByTestId('placement-host');

// プロダクト詳細ページと同じく、本文とサイドバー(20rem・1280px以上は22rem)の2列のグリッドのサイドバーに描く
const renderSidebar = async (signedIn: boolean): Promise<RouterContext> => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <div className="grid gap-x-6 gap-y-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <p className="min-w-0">{OTHER_CONTENT}</p>
      <div data-testid="placement-host" className="flex flex-col gap-4">
        <GoldSidebarPlacement viewer={{ signedIn }} />
      </div>
    </div>,
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

const regionNames = () => adNamesIn(region().getByRole('listitem').elements());

afterEach(() => {
  executeGraphQL.mockReset();
  applyColorScheme('light');
});

describe('GoldSidebarPlacement', () => {
  test.each([375, 1023, 1024, 1280])(
    '画面幅%ipxでも、Goldの広告を全件、取得した順に縦に並べる',
    async (width) => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      respondWith(placementsOf({ legend: 1, gold: 4, silver: 1 }));

      await renderSidebar(false);

      await expect.element(region()).toBeVisible();
      expect(regionNames()).toEqual(adNamesOf('GOLD', 4));
    },
  );

  test.each<[number, number]>([
    [1024, 320],
    [1279, 320],
    [1280, 352],
  ])(
    '画面幅%ipxでは、幅280pxでサイドバー(%ipx)の先頭(左)に寄せ、サイドバーの幅を変えない',
    async (width, sidebarWidth) => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      respondWith(placementsOf({ gold: 2 }));

      await renderSidebar(true);

      await expect.element(region()).toBeVisible();
      const stack = region().element().getBoundingClientRect();
      const sidebar = host().element().getBoundingClientRect();
      expect(stack.width).toBe(STACK_WIDTH_PX);
      expect(stack.left).toBe(sidebar.left);
      expect(sidebar.width).toBe(sidebarWidth);
    },
  );

  test('画面幅が1024px未満なら、サイドバーの位置の幅いっぱいに並べる', async () => {
    await page.viewport(1023, VIEWPORT_HEIGHT);
    respondWith(placementsOf({ gold: 2 }));

    await renderSidebar(false);

    await expect.element(region()).toBeVisible();
    expect(region().element().getBoundingClientRect().width).toBe(
      host().element().getBoundingClientRect().width,
    );
  });

  test('ログイン中は広告の並びの末尾に申込の導線を示す', async () => {
    respondWith(placementsOf({ gold: 2 }));

    await renderSidebar(true);

    await expect.element(applyLink()).toBeVisible();
    expect(region().getByRole('link').elements().at(-1)).toBe(
      applyLink().element(),
    );
  });

  test('サーバーの描画の結果に、Goldの広告を全件含める', () => {
    const html = renderPlacementsOnServer(
      <GoldSidebarPlacement viewer={{ signedIn: false }} />,
      placementsOf({ gold: 3 }),
    );

    expect(adNamesIn([...html.querySelectorAll('li')])).toEqual(
      adNamesOf('GOLD', 3),
    );
  });

  test('広告が0件なら、未ログインの閲覧者には何も描かない', async () => {
    respondWith(placementsOf({ legend: 1 }));

    const context = await renderSidebar(false);

    await waitForSettled(context);
    expect(host().element().childElementCount).toBe(0);
  });

  test('取得に失敗したら、何も描かず、失敗の表示も出さずにページの他の内容を残す', async () => {
    respond(PLACEMENTS_LOAD_FAILURE);

    const context = await renderSidebar(true);

    await waitForSettled(context);
    await expect.element(page.getByText(OTHER_CONTENT)).toBeVisible();
    expect(placementCalls()).toHaveLength(1);
    expect(host().element().childElementCount).toBe(0);
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(page.getByRole('button').elements()).toHaveLength(0);
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });

  test.each(COLOR_SCHEMES)('%sの配色でaxeの違反が0件である', async (scheme) => {
    applyColorScheme(scheme);
    respondWith(placementsOf({ gold: 2 }));

    await renderSidebar(true);

    await expect.element(applyLink()).toBeVisible();
    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
