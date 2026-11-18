import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  QUALIFIER_LIST_INSERTS,
  TOP_PAGE_SECTIONS,
} from '../../composition/top-page-sections.ts';
import {
  ClientSponsoredPlacementsDocument,
  type ClientSponsoredPlacementsQuery,
} from '../../graphql/generated/graphql.ts';
import { UpvoteBotProtection } from '../match/upvote-bot-protection.tsx';
import {
  qualifierBoardOf,
  qualifierMatchesOf,
} from '../top/qualifier-board-fixtures.ts';
import { QualifierSection } from '../top/qualifier-section.tsx';
import { TopPage } from '../top/top-page.tsx';
import type {
  QualifierListInsert,
  TopPageSection,
  TopPageSectionContext,
} from '../top/top-page-section-types.ts';
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

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const MATCH_COUNT = 4;

const BOARD: TopPageSectionContext['board'] = Object.freeze({
  date: '2026-11-10',
  phase: 'RESULT',
  serverTime: '2026-11-10T14:45:00.000Z',
});

const SPONSORSHIP_SECTIONS = TOP_PAGE_SECTIONS.filter(({ id }) =>
  id.startsWith('sponsorship.'),
);

// 登録口の予選の区画の代わりに、取得を持たない予選の一覧に差し込みの登録口を渡して本文の列に置く
const qualifiersWith = (
  inserts: readonly QualifierListInsert[],
): TopPageSection => ({
  id: 'test.qualifiers',
  placement: 'main',
  order: 30,
  component: function TestQualifiers({ viewer }: TopPageSectionContext) {
    return (
      <QualifierSection
        board={qualifierBoardOf({
          matches: qualifierMatchesOf(MATCH_COUNT),
          byes: [],
        })}
        signedIn={viewer.signedIn}
        onUpdated={() => undefined}
        inserts={inserts}
      />
    );
  },
});

const respond = (placements: unknown) => {
  vi.mocked(executeGraphQL).mockImplementation(((document: unknown) =>
    document === ClientSponsoredPlacementsDocument
      ? Promise.resolve(placements)
      : Promise.reject(new Error('想定外の操作です。'))) as never);
};

const respondWith = (data: ClientSponsoredPlacementsQuery) => {
  respond({ ok: true, data });
};

const renderTopPage = async ({
  sponsorship = true,
}: { readonly sponsorship?: boolean } = {}) => {
  const context = createPageRouterContext('local');
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
  await renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <TooltipProvider>
        <main className="bg-background text-foreground">
          <UpvoteBotProtection>
            <TopPage
              sections={
                sponsorship
                  ? [
                      ...SPONSORSHIP_SECTIONS,
                      qualifiersWith(QUALIFIER_LIST_INSERTS),
                    ]
                  : [qualifiersWith([])]
              }
              board={BOARD}
              signedIn={false}
              hasQualifierMatches={false}
            />
          </UpvoteBotProtection>
        </main>
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    { context },
  );
  await expect
    .element(page.getByRole('region', { name: /^予選/u }))
    .toBeVisible();
  if (sponsorship) {
    await waitForPlacementsSettled(context.queryClient);
  }
};

const qualifierRegion = () => page.getByRole('region', { name: /^予選/u });

const measure = () => {
  const qualifiers = rectOf(qualifierRegion().element());
  return {
    qualifiersLeft: qualifiers.left,
    qualifiersTop: qualifiers.top,
    qualifiersWidth: qualifiers.width,
    pageBottom: document.documentElement.scrollHeight,
  };
};

const measureWithoutPlacements = async () => {
  await renderTopPage({ sponsorship: false });
  const baseline = measure();
  await cleanup();
  return baseline;
};

const bannerGrid = (): Element | null | undefined =>
  legendRegion().element().closest('.grid');

beforeEach(() => {
  vi.mocked(executeGraphQL).mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  resetFakeTurnstile();
  window.scrollTo(0, 0);
});

afterEach(async () => {
  applyColorScheme('light');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('トップページの広告スペース', () => {
  test('画面幅1280pxでは、上部の行の全幅にLegend、本文の横の列にGoldの全件、フッター直上にSilverを描き、予選の一覧には差し込まない', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
    respondWith(placementsOf({ legend: 2, gold: 3, silver: 2 }));

    await renderTopPage();

    await expect.element(legendRegion()).toBeVisible();
    const legend = rectOf(legendRegion().element());
    expect(legend.width).toBe(rectOf(bannerGrid()).width);
    expect(legend.bottom).toBeLessThanOrEqual(
      rectOf(qualifierRegion().element()).top,
    );
    expect(adNamesIn(goldRegion().getByRole('listitem').elements())).toEqual(
      adNamesOf('GOLD', 3),
    );
    expect(rectOf(goldRegion().element()).left).toBeGreaterThan(
      rectOf(qualifierRegion().element()).right,
    );
    expect(
      qualifierRegion().getByRole('link', { name: AD_LINK_NAME }).elements(),
    ).toHaveLength(0);
    const silver = rectOf(silverRegion().element());
    expect(silver.top).toBeGreaterThanOrEqual(
      rectOf(goldRegion().element()).bottom,
    );
    expect(silver.top).toBeGreaterThanOrEqual(
      rectOf(qualifierRegion().element()).bottom,
    );
    // Silverの器は余白を内側に持つため、内容の領域をLegendの置かれた本文の器の内側とそろえる
    const silverStyle = getComputedStyle(silverRegion().element());
    const paddingLeft = Number.parseFloat(silverStyle.paddingLeft);
    const paddingRight = Number.parseFloat(silverStyle.paddingRight);
    expect(silver.left + paddingLeft).toBe(legend.left);
    expect(silver.width - paddingLeft - paddingRight).toBe(legend.width);
  });

  test('画面幅375pxでは、予選の一覧の2件ごとにGoldを1枚差し込み、余りを本文の下に並べる', async () => {
    await page.viewport(MOBILE.width, MOBILE.height);
    respondWith(placementsOf({ gold: 3 }));

    await renderTopPage();

    await vi.waitFor(() => {
      expect(adNamesIn(goldRegion().getByRole('listitem').elements())).toEqual(
        adNamesOf('GOLD', 3).slice(2),
      );
    });
    expect(
      qualifierRegion().getByRole('link', { name: AD_LINK_NAME }).elements(),
    ).toHaveLength(2);
    expect(rectOf(goldRegion().element()).top).toBeGreaterThan(
      rectOf(qualifierRegion().element()).bottom,
    );
  });

  test('画面幅375pxで全てのGoldを予選の一覧に差し込んだら、未ログインの閲覧者には空の横の列と間隔を残さない', async () => {
    await page.viewport(MOBILE.width, MOBILE.height);
    respondWith(placementsOf({ gold: 2 }));

    await renderTopPage();

    await vi.waitFor(() => {
      expect(
        qualifierRegion().getByRole('link', { name: AD_LINK_NAME }).elements(),
      ).toHaveLength(2);
    });
    expect(goldRegion().elements()).toHaveLength(0);
    expect(displayOf('[data-top-page-aside]')).toBe('none');
    const columns = document.querySelector(
      '[data-top-page-aside]',
    )?.parentElement;
    expect(rectOf(columns).bottom).toBe(
      rectOf(qualifierRegion().element()).bottom,
    );
  });

  test.each([
    ['画面幅1280px', DESKTOP],
    ['画面幅375px', MOBILE],
  ])(
    '%sで広告が0件なら、未ログインの閲覧者には何も描かず、空の枠・横の列と間隔を残さない',
    async (_label, viewport) => {
      await page.viewport(viewport.width, viewport.height);
      const baseline = await measureWithoutPlacements();
      respondWith(placementsOf({}));

      await renderTopPage();

      expect(
        page.getByRole('region', { name: /スポンサー広告$/u }).elements(),
      ).toHaveLength(0);
      expect(displayOf('[data-top-page-aside]')).toBe('none');
      expect(measure()).toStrictEqual(baseline);
    },
  );

  test.each([
    ['画面幅1280px', DESKTOP],
    ['画面幅375px', MOBILE],
  ])(
    '%sで広告の取得に失敗しても、失敗の表示を出さず、予選の一覧を広告が無いときと同じ配置で表示する',
    async (_label, viewport) => {
      await page.viewport(viewport.width, viewport.height);
      const baseline = await measureWithoutPlacements();
      respond(PLACEMENTS_LOAD_FAILURE);

      await renderTopPage();

      expect(page.getByText(UNEXPECTED_MESSAGE).elements()).toHaveLength(0);
      expect(page.getByRole('alert').elements()).toHaveLength(0);
      expect(measure()).toStrictEqual(baseline);
      expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、3つのティアの広告を描いたトップページのaxeの違反が0件である',
    async (scheme) => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      applyColorScheme(scheme);
      respondWith(placementsOf({ legend: 2, gold: 3, silver: 2 }));

      await renderTopPage();

      await expect.element(silverRegion()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
