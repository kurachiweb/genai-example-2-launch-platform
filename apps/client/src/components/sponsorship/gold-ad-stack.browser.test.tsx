import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { SponsoredAdFieldsFragment } from '../../graphql/generated/graphql.ts';
import { GoldAdStack } from './gold-ad-stack.tsx';
import {
  adNamesIn,
  adNamesOf,
  sponsoredAdsOf,
} from './sponsored-placements-fixtures.ts';
import {
  SPONSORSHIP_APPLY_HREF,
  SPONSORSHIP_APPLY_LINK_LABEL,
} from './sponsorship-messages.ts';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const REGION_NAME = 'Goldスポンサー広告';

const VIEWPORT_HEIGHT = 900;

const STACK_WIDTH_PX = 280;

const region = () => page.getByRole('region', { name: REGION_NAME });

const applyLink = () =>
  page.getByRole('link', { name: SPONSORSHIP_APPLY_LINK_LABEL });

const renderStack = (
  ads: readonly SponsoredAdFieldsFragment[],
  signedIn: boolean,
  hostWidth = 320,
) =>
  renderInRouter(
    <div
      data-testid="placement-host"
      style={{ width: `${String(hostWidth)}px` }}
    >
      <GoldAdStack ads={ads} signedIn={signedIn} />
    </div>,
  );

const host = () => page.getByTestId('placement-host');

afterEach(() => {
  applyColorScheme('light');
});

describe('GoldAdStack', () => {
  test('名前付きの領域に受け取った広告を全件、受け取った順に縦に並べる', async () => {
    await renderStack(sponsoredAdsOf('GOLD', 3), false);

    await expect.element(region()).toBeVisible();
    const items = region().getByRole('listitem').elements();
    expect(adNamesIn(items)).toEqual(adNamesOf('GOLD', 3));
    const rects = items.map((item) => item.getBoundingClientRect());
    const pairs = rects.slice(1).map((rect, index) => [rects[index], rect]);
    for (const [above, below] of pairs) {
      expect(below?.top).toBeGreaterThanOrEqual(above?.bottom ?? Infinity);
      expect(below?.left).toBe(above?.left);
    }
  });

  test.each([
    ['幅320pxの列', 320],
    ['幅の広い置き場所', 900],
  ])(
    '画面幅が1024px以上なら、%sの中でも幅280pxで先頭(左)に寄せる',
    async (_label, hostWidth) => {
      await page.viewport(1024, VIEWPORT_HEIGHT);

      await renderStack(sponsoredAdsOf('GOLD', 2), true, hostWidth);

      await expect.element(region()).toBeVisible();
      const rect = region().element().getBoundingClientRect();
      expect(rect.width).toBe(STACK_WIDTH_PX);
      expect(rect.left).toBe(host().element().getBoundingClientRect().left);
    },
  );

  test.each([
    ['幅320pxの列', 320],
    ['幅600pxの置き場所', 600],
  ])(
    '画面幅が1024px未満なら、%sの幅いっぱいに並べる',
    async (_label, hostWidth) => {
      await page.viewport(1023, VIEWPORT_HEIGHT);

      await renderStack(sponsoredAdsOf('GOLD', 2), true, hostWidth);

      await expect.element(region()).toBeVisible();
      expect(region().element().getBoundingClientRect().width).toBe(hostWidth);
    },
  );

  test('ログイン中は広告の並びの末尾に料金ページのスポンサー広告への申込の導線を示す', async () => {
    await renderStack(sponsoredAdsOf('GOLD', 2), true);

    await expect.element(applyLink()).toBeVisible();
    await expect
      .element(applyLink())
      .toHaveAttribute('href', SPONSORSHIP_APPLY_HREF);
    const links = region().getByRole('link').elements();
    expect(links.at(-1)).toBe(applyLink().element());
    const lastItem = region().getByRole('listitem').elements().at(-1);
    expect(applyLink().element().getBoundingClientRect().top).toBeGreaterThan(
      lastItem?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
    );
  });

  test('未ログインでは申込の導線を示さない', async () => {
    await renderStack(sponsoredAdsOf('GOLD', 2), false);

    await expect.element(region()).toBeVisible();
    expect(applyLink().elements()).toHaveLength(0);
  });

  test('広告が0件なら、ログイン中の閲覧者には申込の導線だけを示す', async () => {
    await renderStack([], true);

    await expect.element(region()).toBeVisible();
    await expect.element(applyLink()).toBeVisible();
    expect(region().getByRole('list').elements()).toHaveLength(0);
    expect(region().getByRole('link').elements()).toHaveLength(1);
  });

  test('広告が0件なら、未ログインの閲覧者には何も描かない', async () => {
    await renderStack([], false);

    await expect.element(host()).toBeInTheDocument();
    expect(host().element().childElementCount).toBe(0);
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、広告と申込の導線のaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);

      await renderStack(sponsoredAdsOf('GOLD', 2), true);

      await expect.element(applyLink()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
