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
import { SilverPlacement } from './silver-placement.tsx';
import {
  adNamesIn,
  adNamesOf,
  PLACEMENTS_LOAD_FAILURE,
  placementsOf,
} from './sponsored-placements-fixtures.ts';
import {
  SPONSORSHIP_APPLY_HREF,
  SPONSORSHIP_APPLY_LINK_LABEL,
} from './sponsorship-messages.ts';
import { sponsoredPlacementsQueryOptions } from './use-sponsored-placements.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const REGION_NAME = 'Silverスポンサー広告';

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

const applyLink = () =>
  page.getByRole('link', { name: SPONSORSHIP_APPLY_LINK_LABEL });

const renderSilver = async (signedIn: boolean): Promise<RouterContext> => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <>
      <div data-testid="placement-host">
        <SilverPlacement viewer={{ signedIn }} />
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

const topsOf = (elements: readonly Element[]): readonly number[] =>
  elements.map((element) => Math.round(element.getBoundingClientRect().top));

afterEach(() => {
  executeGraphQL.mockReset();
  applyColorScheme('light');
});

describe('SilverPlacement', () => {
  test('名前付きの領域にSilverの広告を全件、取得した順に一覧で並べる', async () => {
    respondWith(placementsOf({ legend: 2, gold: 2, silver: 3 }));

    await renderSilver(false);

    await expect.element(region()).toBeVisible();
    const items = region().getByRole('listitem').elements();
    expect(adNamesIn(items)).toEqual(adNamesOf('SILVER', 3));
  });

  test('1行に複数枚を並べ、入り切らない広告を次の行へ折り返し、横にはみ出さない', async () => {
    await page.viewport(1024, VIEWPORT_HEIGHT);
    respondWith(placementsOf({ silver: 16 }));

    await renderSilver(false);

    await expect.element(region()).toBeVisible();
    const tops = topsOf(region().getByRole('listitem').elements());
    const firstRowCount = tops.filter((top) => top === tops[0]).length;
    expect(firstRowCount).toBeGreaterThan(1);
    expect(new Set(tops).size).toBeGreaterThan(1);
    const list = region().getByRole('list').element();
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
  });

  test.each([1600, 375])(
    '画面幅%ipxで、置き場所の幅の器に任せ、自分では余白と上の間隔を持たずに置き場所の幅いっぱいに並べる',
    async (viewportWidth) => {
      await page.viewport(viewportWidth, VIEWPORT_HEIGHT);
      respondWith(placementsOf({ silver: 3 }));

      await renderSilver(false);

      await expect.element(region()).toBeVisible();
      const available = page
        .getByTestId('placement-host')
        .element()
        .getBoundingClientRect();
      const section = region().element();
      const rect = section.getBoundingClientRect();
      expect(rect.width).toBe(available.width);
      expect(rect.left).toBe(available.left);
      expect(rect.top).toBe(available.top);
      const style = getComputedStyle(section);
      expect(style.paddingLeft).toBe('0px');
      expect(style.paddingRight).toBe('0px');
      expect(style.paddingTop).toBe('0px');
    },
  );

  test('ログイン中は広告の並びの末尾に料金ページのスポンサー広告への申込の導線を示す', async () => {
    respondWith(placementsOf({ silver: 2 }));

    await renderSilver(true);

    await expect.element(applyLink()).toBeVisible();
    await expect
      .element(applyLink())
      .toHaveAttribute('href', SPONSORSHIP_APPLY_HREF);
    const links = region().getByRole('link').elements();
    expect(links.at(-1)).toBe(applyLink().element());
  });

  test('未ログインでは申込の導線を示さない', async () => {
    respondWith(placementsOf({ silver: 2 }));

    await renderSilver(false);

    await expect.element(region()).toBeVisible();
    expect(applyLink().elements()).toHaveLength(0);
  });

  test('広告が0件なら、ログイン中の閲覧者には申込の導線だけを示す', async () => {
    respondWith(placementsOf({ legend: 1, gold: 1 }));

    await renderSilver(true);

    await expect.element(region()).toBeVisible();
    await expect.element(applyLink()).toBeVisible();
    expect(region().getByRole('list').elements()).toHaveLength(0);
    expect(region().getByRole('link').elements()).toHaveLength(1);
  });

  test('広告が0件なら、未ログインの閲覧者には何も描かない', async () => {
    respondWith(placementsOf({ legend: 1, gold: 1 }));

    const context = await renderSilver(false);

    await expectNothingDrawn(context);
  });

  test.each([
    ['未ログイン', false],
    ['ログイン中', true],
  ])(
    '取得に失敗したら、%sの閲覧者にも申込の導線を含めて何も描かず、失敗の表示も出さずにページの他の内容を残す',
    async (_label, signedIn) => {
      respond(PLACEMENTS_LOAD_FAILURE);

      const context = await renderSilver(signedIn);

      await expectNothingDrawn(context);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、広告と申込の導線のaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      respondWith(placementsOf({ silver: 3 }));

      await renderSilver(true);

      await expect.element(applyLink()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
