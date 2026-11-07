import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import type { RouterContext } from '../../../lib/start/router-context.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import {
  createPageRouterContext,
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientUltrasOfferDocument,
  type ClientUltrasOfferQuery,
  ClientViewerUltrasDocument,
  type ClientViewerUltrasQuery,
  type ClientViewerQuery,
  type UltrasPlanStatus,
} from '../../graphql/generated/graphql.ts';
import {
  ultrasOfferQueryOptions,
  viewerUltrasQueryOptions,
} from '../../graphql/ultras.ts';
import { toClientViewer } from '../../graphql/viewer.ts';
import { UltrasPricingSection } from './ultras-pricing-section.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const SECTION_TITLE = 'Ultras';
const PRICE_UNAVAILABLE = '現在表示できません';
const SUBSCRIBE_LABEL = 'Ultrasに加入';
const VIEW_PLAN_LABEL = 'プランを見る';
const BENEFITS_TITLE = '特典';
const RENEWAL_TITLE = '自動更新と解約';
const AUTO_RENEWAL_NOTE_OF_999 =
  'Ultrasプランは毎月自動で更新され、毎月の更新日に$9.99(税込)を自動でお支払いいただきます。';
const AUTO_RENEWAL_NOTE_WITHOUT_AMOUNT =
  'Ultrasプランは毎月自動で更新され、毎月の更新日に月額料金を自動でお支払いいただきます。';

const NEW_YORK_EN: DisplayPreferences = {
  timeZone: 'America/New_York',
  locale: 'en-US',
};

const SIGNED_IN_VIEWER = signedInViewerQuery();

interface OfferOptions {
  readonly promotionEnabled: boolean;
  readonly price?: number | null;
}

const offerOf = ({
  promotionEnabled,
  price = 999,
}: OfferOptions): ClientUltrasOfferQuery => ({
  ultrasOffer: {
    price: price === null ? null : { amount: price, currency: 'usd' },
    priceStale: false,
    promotionEnabled,
  },
});

const NOT_ENTITLED: ClientViewerUltrasQuery = {
  viewerUltras: { entitled: false, canOpenPortal: false, plan: null },
};

const GUEST_ULTRAS: ClientViewerUltrasQuery = { viewerUltras: null };

const entitledOf = (status: UltrasPlanStatus): ClientViewerUltrasQuery => ({
  viewerUltras: {
    entitled: true,
    canOpenPortal: true,
    plan: {
      status,
      startedAt: '2026-11-01T00:00:00.000Z',
      currentPeriodEndsAt: '2026-12-01T00:00:00.000Z',
      canceledAt: status === 'CANCELED' ? '2026-11-10T00:00:00.000Z' : null,
      benefitEndsAt: status === 'CANCELED' ? '2026-12-01T00:00:00.000Z' : null,
    },
  },
});

interface Responses {
  readonly offer: ClientUltrasOfferQuery;
  readonly viewerUltras: ClientViewerUltrasQuery;
}

// 文書ごとに結果を返し分け、ページの文脈に無い文書の取得は失敗にして取りこぼしを見逃さない
const respond = ({ offer, viewerUltras }: Responses) => {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientUltrasOfferDocument) {
      return Promise.resolve({ ok: true, data: offer });
    }
    if (document === ClientViewerUltrasDocument) {
      return Promise.resolve({ ok: true, data: viewerUltras });
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

interface RenderOptions {
  readonly viewerQuery?: ClientViewerQuery;
}

const renderSection = async ({
  viewerQuery = GUEST_VIEWER_QUERY,
}: RenderOptions = {}) => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <DisplayPreferencesProvider initial={NEW_YORK_EN}>
      <main>
        <Suspense fallback={<LoadingSkeleton />}>
          <UltrasPricingSection />
        </Suspense>
      </main>
    </DisplayPreferencesProvider>,
    { context, cachedViewer: viewerQuery },
  );
  return context;
};

const queriesSettled = (
  context: RouterContext,
  viewerQuery: ClientViewerQuery,
) =>
  [
    ultrasOfferQueryOptions().queryKey,
    viewerUltrasQueryOptions(toClientViewer(viewerQuery)).queryKey,
  ].every(
    (queryKey) =>
      context.queryClient.getQueryState(queryKey)?.status === 'success',
  );

const sectionHeading = () =>
  page.getByRole('heading', { level: 2, name: SECTION_TITLE });
const region = () => page.getByRole('region', { name: SECTION_TITLE });
const subscribeButton = () =>
  page.getByRole('button', { name: SUBSCRIBE_LABEL });
const viewPlanLink = () => page.getByRole('link', { name: VIEW_PLAN_LABEL });
const renewalItems = () =>
  page
    .getByRole('list', { name: RENEWAL_TITLE })
    .getByRole('listitem')
    .elements()
    .map((item) => item.textContent);

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(NEW_YORK_EN);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('UltrasPricingSection', () => {
  test('機能フラグがオンなら、見出し「Ultras」の区画に月額の価格(税込)・特典と条件の一覧・加入のボタンを描き、価格と加入状態の2つを取得する', async () => {
    respond({
      offer: offerOf({ promotionEnabled: true }),
      viewerUltras: GUEST_ULTRAS,
    });

    await renderSection();

    await expect.element(sectionHeading()).toBeVisible();
    await expect.element(region()).toBeVisible();
    await expect
      .element(page.getByText('月額$9.99(税込)', { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 3, name: BENEFITS_TITLE }))
      .toBeVisible();
    expect(renewalItems()[0]).toBe(AUTO_RENEWAL_NOTE_OF_999);
    await expect.element(subscribeButton()).toBeEnabled();
    expect(viewPlanLink().query()).toBeNull();
    expect(document.body.textContent).not.toContain('加入状態');
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientUltrasOfferDocument,
      {},
      expect.anything(),
    );
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientViewerUltrasDocument,
      {},
      expect.anything(),
    );
  });

  test('読み込み中は、読み込み中の状態だけを示す', async () => {
    executeGraphQL.mockReturnValue(new Promise(() => undefined));

    await renderSection();

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('読み込み中');
    expect(sectionHeading().query()).toBeNull();
  });

  test('機能フラグがオフで特典の継続期間内にない閲覧者には、取得が終わっても区画を描かない', async () => {
    respond({
      offer: offerOf({ promotionEnabled: false }),
      viewerUltras: NOT_ENTITLED,
    });

    const context = await renderSection({ viewerQuery: SIGNED_IN_VIEWER });

    await expect
      .poll(() => queriesSettled(context, SIGNED_IN_VIEWER))
      .toBe(true);
    expect(sectionHeading().query()).toBeNull();
    expect(page.getByRole('status').query()).toBeNull();
    expect(document.body.textContent.trim()).toBe('');
  });

  test('機能フラグがオフでも未ログインの閲覧者には、加入状態がnullのため区画を描かない', async () => {
    respond({
      offer: offerOf({ promotionEnabled: false }),
      viewerUltras: GUEST_ULTRAS,
    });

    const context = await renderSection();

    await expect
      .poll(() => queriesSettled(context, GUEST_VIEWER_QUERY))
      .toBe(true);
    expect(document.body.textContent.trim()).toBe('');
  });

  test('機能フラグがオフでも特典の継続期間内の閲覧者には、区画と「加入状態: 有効」とプラン管理画面への導線を描き、加入のボタンを描かない', async () => {
    respond({
      offer: offerOf({ promotionEnabled: false }),
      viewerUltras: entitledOf('ACTIVE'),
    });

    await renderSection({ viewerQuery: SIGNED_IN_VIEWER });

    await expect.element(sectionHeading()).toBeVisible();
    await expect
      .element(page.getByText('加入状態: 有効', { exact: true }))
      .toBeVisible();
    await expect
      .element(viewPlanLink())
      .toHaveAttribute('href', '/settings/plan');
    expect(subscribeButton().query()).toBeNull();
    await expect
      .element(page.getByText('月額$9.99(税込)', { exact: true }))
      .toBeVisible();
  });

  test.each([
    ['PAST_DUE', '支払いの再試行中'],
    ['CANCELED', '解約済み'],
  ] as const)(
    '加入状態が%sなら、「加入状態: %s」と表示する',
    async (status, label) => {
      respond({
        offer: offerOf({ promotionEnabled: true }),
        viewerUltras: entitledOf(status),
      });

      await renderSection({ viewerQuery: SIGNED_IN_VIEWER });

      await expect
        .element(page.getByText(`加入状態: ${label}`, { exact: true }))
        .toBeVisible();
      expect(subscribeButton().query()).toBeNull();
    },
  );

  test('価格を照会できないときは、価格の位置に「現在表示できません」を示し、加入のボタンを無効にしてその文言を理由として結び付け、金額を差し込まない条件の文を示す', async () => {
    respond({
      offer: offerOf({ promotionEnabled: true, price: null }),
      viewerUltras: GUEST_ULTRAS,
    });

    await renderSection();

    await expect
      .element(page.getByText(PRICE_UNAVAILABLE, { exact: true }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('(税込)');
    await expect.element(subscribeButton()).toBeDisabled();
    await expect
      .element(subscribeButton())
      .toHaveAccessibleDescription(PRICE_UNAVAILABLE);
    expect(renewalItems()[0]).toBe(AUTO_RENEWAL_NOTE_WITHOUT_AMOUNT);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('価格と加入のボタンの表示で、アクセシビリティの検査の違反が0件', async () => {
      respond({
        offer: offerOf({ promotionEnabled: true }),
        viewerUltras: GUEST_ULTRAS,
      });
      await renderSection();
      await expect.element(subscribeButton()).toBeEnabled();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('価格が無く加入のボタンが無効の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond({
        offer: offerOf({ promotionEnabled: true, price: null }),
        viewerUltras: GUEST_ULTRAS,
      });
      await renderSection();
      await expect.element(subscribeButton()).toBeDisabled();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('加入状態と導線の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond({
        offer: offerOf({ promotionEnabled: false }),
        viewerUltras: entitledOf('ACTIVE'),
      });
      await renderSection({ viewerQuery: SIGNED_IN_VIEWER });
      await expect.element(viewPlanLink()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
