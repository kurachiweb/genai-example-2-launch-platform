import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import type { RouterContext } from '../../../lib/start/router-context.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { ClientSponsoredPlacementsDocument } from '../../graphql/generated/graphql.ts';
import {
  adNamesIn,
  adNamesOf,
  placementsOf,
} from './sponsored-placements-fixtures.ts';
import { SPONSORSHIP_APPLY_LINK_LABEL } from './sponsorship-messages.ts';
import { TopPageSilverPlacement } from './top-page-silver-placement.tsx';
import { sponsoredPlacementsQueryOptions } from './use-sponsored-placements.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const REGION_NAME = 'Silverスポンサー広告';

const VIEWPORT_HEIGHT = 900;

// max-w-7xl
const MAX_WIDTH_PX = 1280;

const SIDE_PADDING_PX = 16;

// pt-10。トップページの本文の列と横の列の器の上の間隔と同じ
const TOP_SPACING_PX = 40;

const respondWith = (data: unknown) => {
  executeGraphQL.mockImplementation((document: unknown) =>
    document === ClientSponsoredPlacementsDocument
      ? Promise.resolve({ ok: true, data })
      : Promise.reject(new Error('想定外の操作です。')),
  );
};

const region = () => page.getByRole('region', { name: REGION_NAME });

const host = () => page.getByTestId('placement-host');

const renderSilver = async (signedIn: boolean): Promise<RouterContext> => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <div data-testid="placement-host" className="flex flex-col">
      <TopPageSilverPlacement viewer={{ signedIn }} />
    </div>,
    { context },
  );
  return context;
};

afterEach(() => {
  executeGraphQL.mockReset();
});

describe('TopPageSilverPlacement', () => {
  test.each([
    ['最大幅より広い', 1600],
    ['最大幅より狭い', 375],
  ])(
    'フッター直上の置き場所が%s(画面幅%ipx)ときも、最大幅を超えずに中央に置き、左右の余白と上の間隔を持つ',
    async (_label, viewportWidth) => {
      await page.viewport(viewportWidth, VIEWPORT_HEIGHT);
      respondWith(placementsOf({ silver: 3 }));

      await renderSilver(false);

      await expect.element(region()).toBeVisible();
      expect(adNamesIn(region().getByRole('listitem').elements())).toEqual(
        adNamesOf('SILVER', 3),
      );
      const available = host().element().getBoundingClientRect();
      const width = Math.min(MAX_WIDTH_PX, available.width);
      const section = region().element();
      const rect = section.getBoundingClientRect();
      expect(rect.width).toBe(width);
      expect(rect.left - available.left).toBe((available.width - width) / 2);
      const style = getComputedStyle(section);
      expect(style.paddingLeft).toBe(`${String(SIDE_PADDING_PX)}px`);
      expect(style.paddingRight).toBe(`${String(SIDE_PADDING_PX)}px`);
      expect(style.paddingTop).toBe(`${String(TOP_SPACING_PX)}px`);
    },
  );

  test('ログイン中は広告の並びの末尾に申込の導線を示す', async () => {
    respondWith(placementsOf({ silver: 1 }));

    await renderSilver(true);

    await expect
      .element(
        region().getByRole('link', { name: SPONSORSHIP_APPLY_LINK_LABEL }),
      )
      .toBeVisible();
  });

  test('広告が0件なら、未ログインの閲覧者には器も描かず、置き場所に高さを残さない', async () => {
    respondWith(placementsOf({ legend: 1, gold: 1 }));

    const context = await renderSilver(false);

    await vi.waitFor(() => {
      expect(
        context.queryClient.getQueryState(
          sponsoredPlacementsQueryOptions().queryKey,
        )?.status,
      ).toBe('success');
    });
    for (let frame = 0; frame < 2; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    expect(host().element().childElementCount).toBe(0);
    expect(host().element().getBoundingClientRect().height).toBe(0);
  });
});
