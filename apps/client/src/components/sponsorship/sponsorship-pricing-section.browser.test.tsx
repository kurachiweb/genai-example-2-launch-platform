import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import type { RouterContext } from '../../../lib/start/router-context.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  createPageRouterContext,
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { PRICING_SECTIONS } from '../../composition/pricing-sections.ts';
import {
  ClientSponsorshipOfferDocument,
  type ClientSponsorshipOfferQuery,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { sponsorshipOfferQueryOptions } from '../../graphql/sponsorship.ts';
import { toClientViewer } from '../../graphql/viewer.ts';
import { PricingPage } from '../ultras/pricing-page.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const SECTION_TITLE = 'スポンサー広告';
const SECTION_ANCHOR = 'sponsorship';
const PRICE_UNAVAILABLE = '現在表示できません';
const RETRY_LABEL = '再試行';
const INTERNAL_ERROR_MESSAGE =
  'サーバーでエラーが発生しました。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const NEW_YORK_EN: DisplayPreferences = {
  timeZone: 'America/New_York',
  locale: 'en-US',
};

const SIGNED_IN_VIEWER = signedInViewerQuery();

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: INTERNAL_ERROR_MESSAGE,
  status: 500,
});

const offerOf = (
  amounts: readonly [number | null, number | null, number | null],
): ClientSponsorshipOfferQuery => ({
  sponsorshipOffer: {
    tiers: (['LEGEND', 'GOLD', 'SILVER'] as const).map((tier, index) => {
      const amount = amounts[index] ?? null;
      return {
        tier,
        unitPrice: amount === null ? null : { amount, currency: 'usd' },
      };
    }),
    eligibleProducts: null,
  },
});

const PRICED_OFFER = offerOf([5000, 2000, 550]);

const UNPRICED_OFFER = offerOf([null, null, null]);

type Outcome = ClientSponsorshipOfferQuery | GraphQLClientError;

// 価格の取得は呼ぶたびに先頭の結果を返し、最後の結果は返し続ける。他の文書の取得は失敗にして取りこぼしを見逃さない
const respond = (...outcomes: readonly Outcome[]): void => {
  const queue = [...outcomes];
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document !== ClientSponsorshipOfferDocument) {
      return Promise.reject(new Error('想定外の文書の取得'));
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return Promise.resolve(
      next instanceof GraphQLClientError
        ? { ok: false, error: next }
        : { ok: true, data: next },
    );
  });
};

const SPONSORSHIP_SECTIONS = PRICING_SECTIONS.filter(
  ({ id }) => id === 'sponsorship.sponsorship-pricing',
);

interface RenderOptions {
  readonly viewerQuery?: ClientViewerQuery;
}

// 料金ページが区画を包む境界の中で、登録した区画を描く
const renderSection = async ({
  viewerQuery = GUEST_VIEWER_QUERY,
}: RenderOptions = {}): Promise<RouterContext> => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <DisplayPreferencesProvider initial={NEW_YORK_EN}>
      <main>
        <PricingPage sections={SPONSORSHIP_SECTIONS} />
      </main>
    </DisplayPreferencesProvider>,
    { context, cachedViewer: viewerQuery },
  );
  return context;
};

const sectionHeading = () =>
  page.getByRole('heading', { level: 2, name: SECTION_TITLE });
const region = () => page.getByRole('region', { name: SECTION_TITLE });

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(NEW_YORK_EN);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('SponsorshipPricingSection', () => {
  test('料金ページの区画に登録され、見出し「スポンサー広告」(アンカー#sponsorship)の区画にティアごとの単価と説明を描き、価格を1回取得する', async () => {
    respond(PRICED_OFFER);

    await renderSection();

    await expect.element(sectionHeading()).toBeVisible();
    await expect
      .element(sectionHeading())
      .toHaveAttribute('id', SECTION_ANCHOR);
    expect(document.querySelectorAll(`#${SECTION_ANCHOR}`)).toHaveLength(1);
    await expect.element(region()).toBeVisible();
    for (const text of ['$50.00/日', '$20.00/日', '$5.50/日']) {
      await expect
        .element(region().getByText(text, { exact: true }))
        .toBeVisible();
    }
    await expect
      .element(
        region().getByText('各ページの上部に大きく表示', { exact: true }),
      )
      .toBeVisible();
    expect(executeGraphQL).toHaveBeenCalledTimes(1);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientSponsorshipOfferDocument,
      {},
      expect.anything(),
    );
  });

  test('ログイン中の閲覧者の価格は、閲覧者のIDを加えたキーで取得する', async () => {
    respond(PRICED_OFFER);

    const context = await renderSection({ viewerQuery: SIGNED_IN_VIEWER });

    await expect.element(region()).toBeVisible();
    expect(
      context.queryClient.getQueryState(
        sponsorshipOfferQueryOptions(toClientViewer(SIGNED_IN_VIEWER)).queryKey,
      )?.status,
    ).toBe('success');
    expect(
      context.queryClient.getQueryState(
        sponsorshipOfferQueryOptions(null).queryKey,
      ),
    ).toBeUndefined();
  });

  test('価格を照会できないときは、3つのティアの単価の位置に「現在表示できません」を示し、表示位置と表示内容の説明を示し続ける', async () => {
    respond(UNPRICED_OFFER);

    await renderSection();

    await expect.element(sectionHeading()).toBeVisible();
    expect(
      region().getByText(PRICE_UNAVAILABLE, { exact: true }).elements(),
    ).toHaveLength(3);
    await expect
      .element(region().getByText('ページの下部に表示', { exact: true }))
      .toBeVisible();
    await expect
      .element(region().getByText('ロゴ・名称', { exact: true }))
      .toBeVisible();
  });

  test('最初の取得に失敗したときは、区画の位置に見出し「スポンサー広告」と失敗の文言と再試行を示し、再試行で単価を描く', async () => {
    respond(INTERNAL_ERROR, PRICED_OFFER);

    await renderSection();

    await expect
      .element(region().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR_MESSAGE);
    await expect.element(sectionHeading()).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: RETRY_LABEL }));

    await expect
      .element(region().getByText('$50.00/日', { exact: true }))
      .toBeVisible();
    expect(page.getByRole('alert').query()).toBeNull();
    await expect
      .element(sectionHeading())
      .toHaveAttribute('id', SECTION_ANCHOR);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('単価を示す区画で、アクセシビリティの検査の違反が0件', async () => {
      respond(PRICED_OFFER);
      await renderSection();
      await expect
        .element(region().getByText('$5.50/日', { exact: true }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('単価を照会できない区画で、アクセシビリティの検査の違反が0件', async () => {
      respond(UNPRICED_OFFER);
      await renderSection();
      await expect.element(region()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
