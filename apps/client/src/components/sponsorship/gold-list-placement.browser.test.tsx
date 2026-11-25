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
import { GoldListInsert } from './gold-list-insert.tsx';
import { GoldListPlacement } from './gold-list-placement.tsx';
import { renderPlacementsOnServer } from './render-placements-on-server.tsx';
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

// ディレクトリの横の列(lg:w-80)
const DIRECTORY_ASIDE_WIDTH_PX = 320;

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

const insertNames = () =>
  adNamesIn(page.getByTestId('insert-item').elements()).filter(
    (name) => name !== undefined,
  );

// ページと同じく、一覧の項目の間の差し込みと、横の列(1024px未満は一覧の下)の置き場所を同じページに描く
const renderPlacement = async ({
  signedIn,
  inserts = 0,
}: {
  readonly signedIn: boolean;
  readonly inserts?: number;
}): Promise<RouterContext> => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <ul className="flex flex-col gap-3">
          {Array.from({ length: inserts }, (_, index) => (
            <li key={index} data-testid="insert-item">
              <GoldListInsert position={index + 1} />
            </li>
          ))}
        </ul>
        <p>{OTHER_CONTENT}</p>
      </div>
      <div
        data-testid="placement-host"
        className="flex flex-col gap-6 lg:w-80 lg:shrink-0"
      >
        <GoldListPlacement viewer={{ signedIn }} />
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
  // 取得の結果を受けた描き直し(失敗ならエラーの境界への伝播)と、差し込みの登録の後の描き直しを終えてから確かめる
  for (let frame = 0; frame < 2; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
};

const regionNames = () => adNamesIn(region().getByRole('listitem').elements());

afterEach(() => {
  executeGraphQL.mockReset();
  applyColorScheme('light');
});

describe('GoldListPlacement', () => {
  test.each([1024, 1280])(
    '画面幅%ipxでは、Goldの広告を全件、幅280pxで横の列の先頭(左)に寄せ、列の幅を変えない',
    async (width) => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      respondWith(placementsOf({ legend: 1, gold: 5, silver: 1 }));

      await renderPlacement({ signedIn: false, inserts: 2 });

      await expect.element(region()).toBeVisible();
      expect(regionNames()).toEqual(adNamesOf('GOLD', 5));
      const stack = region().element().getBoundingClientRect();
      const column = host().element().getBoundingClientRect();
      expect(stack.width).toBe(STACK_WIDTH_PX);
      expect(stack.left).toBe(column.left);
      expect(column.width).toBe(DIRECTORY_ASIDE_WIDTH_PX);
      expect(getComputedStyle(region().element()).position).toBe('sticky');
      expect(region().elements()).toHaveLength(1);
    },
  );

  test.each([375, 1023])(
    '画面幅%ipxでは、差し込みが描いた数より後のGoldの広告だけを一覧の下に置き場所の幅いっぱいで並べる',
    async (width) => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      respondWith(placementsOf({ gold: 5 }));

      await renderPlacement({ signedIn: false, inserts: 2 });

      await expect.element(region()).toBeVisible();
      await vi.waitFor(() => {
        expect(regionNames()).toEqual(adNamesOf('GOLD', 5).slice(2));
      });
      expect(insertNames()).toEqual(adNamesOf('GOLD', 2));
      expect(region().elements()).toHaveLength(1);
      expect(region().element().getBoundingClientRect().width).toBe(
        host().element().getBoundingClientRect().width,
      );
    },
  );

  test('画面幅が1024px未満で差し込みが無ければ、Goldの広告を全件一覧の下に並べる', async () => {
    await page.viewport(375, VIEWPORT_HEIGHT);
    respondWith(placementsOf({ gold: 3 }));

    await renderPlacement({ signedIn: false });

    await expect.element(region()).toBeVisible();
    expect(regionNames()).toEqual(adNamesOf('GOLD', 3));
  });

  test('画面幅が1024px未満で全ての広告を差し込みが描いたら、ログイン中の閲覧者には余りの位置に申込の導線だけを示す', async () => {
    await page.viewport(375, VIEWPORT_HEIGHT);
    respondWith(placementsOf({ gold: 2 }));

    const context = await renderPlacement({ signedIn: true, inserts: 3 });

    await waitForSettled(context);
    await expect.element(applyLink()).toBeVisible();
    expect(insertNames()).toEqual(adNamesOf('GOLD', 2));
    expect(region().getByRole('listitem').elements()).toHaveLength(0);
    expect(region().getByRole('link').elements()).toHaveLength(1);
  });

  test('画面幅が1024px未満で全ての広告を差し込みが描いたら、未ログインの閲覧者には余りを描かない', async () => {
    await page.viewport(375, VIEWPORT_HEIGHT);
    respondWith(placementsOf({ gold: 2 }));

    const context = await renderPlacement({ signedIn: false, inserts: 3 });

    await waitForSettled(context);
    await vi.waitFor(() => {
      expect(insertNames()).toEqual(adNamesOf('GOLD', 2));
    });
    expect(region().elements()).toHaveLength(0);
  });

  test('サーバーの描画の結果に、1024px以上の全件の並びを含め、一覧の下の余りを含めない', () => {
    const html = renderPlacementsOnServer(
      <GoldListPlacement viewer={{ signedIn: false }} />,
      placementsOf({ gold: 3 }),
    );

    const sections = html.querySelectorAll(
      `section[aria-label="${REGION_NAME}"]`,
    );
    expect(sections).toHaveLength(1);
    expect(adNamesIn([...html.querySelectorAll('li')])).toEqual(
      adNamesOf('GOLD', 3),
    );
  });

  test('広告が0件なら、ログイン中の閲覧者には申込の導線だけを示す', async () => {
    await page.viewport(1280, VIEWPORT_HEIGHT);
    respondWith(placementsOf({ legend: 1 }));

    await renderPlacement({ signedIn: true });

    await expect.element(applyLink()).toBeVisible();
    expect(region().getByRole('list').elements()).toHaveLength(0);
  });

  test.each([375, 1280])(
    '画面幅%ipxで広告が0件なら、未ログインの閲覧者には何も描かない',
    async (width) => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      respondWith(placementsOf({ legend: 1 }));

      const context = await renderPlacement({ signedIn: false });

      await waitForSettled(context);
      expect(host().element().childElementCount).toBe(0);
    },
  );

  test('取得に失敗したら、何も描かず、失敗の表示も出さずにページの他の内容を残す', async () => {
    await page.viewport(1280, VIEWPORT_HEIGHT);
    respond(PLACEMENTS_LOAD_FAILURE);

    const context = await renderPlacement({ signedIn: true });

    await waitForSettled(context);
    await expect.element(page.getByText(OTHER_CONTENT)).toBeVisible();
    expect(placementCalls()).toHaveLength(1);
    expect(host().element().childElementCount).toBe(0);
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(page.getByRole('button').elements()).toHaveLength(0);
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、差し込みと余りのaxeの違反が0件である',
    async (scheme) => {
      await page.viewport(375, VIEWPORT_HEIGHT);
      applyColorScheme(scheme);
      respondWith(placementsOf({ gold: 3 }));

      await renderPlacement({ signedIn: true, inserts: 1 });

      await expect.element(applyLink()).toBeVisible();
      await vi.waitFor(() => {
        expect(regionNames()).toEqual(adNamesOf('GOLD', 3).slice(1));
      });
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
