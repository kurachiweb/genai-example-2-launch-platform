import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientUltrasOfferDocument,
  type ClientUltrasOfferQuery,
  ClientViewerUltrasDocument,
  type ClientViewerUltrasQuery,
} from '../../graphql/generated/graphql.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { PlanPage } from './plan-page.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const PAGE_TITLE = 'プラン';
const SECTION_TITLE = 'Ultrasの加入状態';
const PORTAL_BUTTON_LABEL = '解約・支払い方法の管理';
const NOT_SUBSCRIBED_MESSAGE = 'Ultrasに加入していません。';
const PENDING_MESSAGE = '変更を反映しています。';
const RETRY_LABEL = '再試行';
const CONTACT_LABEL = 'お問い合わせ';
const RECHECK_MS = 5000;

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const VIEWER_QUERY = signedInViewerQuery();

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const LOAD_FAILURE = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const OFFER: ClientUltrasOfferQuery = {
  ultrasOffer: {
    price: { amount: 999, currency: 'usd' },
    priceStale: false,
    promotionEnabled: true,
  },
};

const ACTIVE_ULTRAS: ClientViewerUltrasQuery = {
  viewerUltras: {
    entitled: true,
    canOpenPortal: true,
    plan: {
      status: 'ACTIVE',
      startedAt: '2026-11-01T00:00:00.000Z',
      currentPeriodEndsAt: '2026-12-01T00:00:00.000Z',
      canceledAt: null,
      benefitEndsAt: null,
    },
  },
};

const NEVER_SUBSCRIBED: ClientViewerUltrasQuery = {
  viewerUltras: { entitled: false, canOpenPortal: false, plan: null },
};

type UltrasResult =
  | { readonly ok: true; readonly data: ClientViewerUltrasQuery }
  | { readonly ok: false; readonly error: GraphQLClientError };

// 加入状態の照会は呼ばれた順に結果を返し、最後の結果を繰り返す。文脈に無い文書の取得は失敗にして取りこぼしを見逃さない
const respond = (ultrasResults: readonly UltrasResult[]) => {
  let ultrasCalls = 0;
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientUltrasOfferDocument) {
      return Promise.resolve({ ok: true, data: OFFER });
    }
    if (document === ClientViewerUltrasDocument) {
      const result =
        ultrasResults[Math.min(ultrasCalls, ultrasResults.length - 1)];
      ultrasCalls += 1;
      return Promise.resolve(result);
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

const respondWithUltras = (viewerUltras: ClientViewerUltrasQuery) => {
  respond([{ ok: true, data: viewerUltras }]);
};

const callsOf = (target: unknown) =>
  executeGraphQL.mock.calls.filter(([document]) => document === target);

const renderPage = async (portalReturned = false) => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <DisplayPreferencesProvider initial={TOKYO_JA}>
      <main>
        <PlanPage viewer={VIEWER} portalReturned={portalReturned} />
      </main>
    </DisplayPreferencesProvider>,
    { context, cachedViewer: VIEWER_QUERY },
  );
  return context;
};

const pageTitle = () =>
  page.getByRole('heading', { level: 1, name: PAGE_TITLE });
const region = () => page.getByRole('region', { name: SECTION_TITLE });
const portalButton = () =>
  page.getByRole('button', { name: PORTAL_BUTTON_LABEL });
const status = () => page.getByRole('status');
const retryButton = () => page.getByRole('button', { name: RETRY_LABEL });

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  applyColorScheme('light');
});

describe('PlanPage', () => {
  test('題名「プラン」の下に加入状態の区画を描き、Portalを開ける利用者には「解約・支払い方法の管理」のボタンを置き、価格と加入状態を1回ずつ取得する', async () => {
    respondWithUltras(ACTIVE_ULTRAS);

    await renderPage();

    await expect.element(pageTitle()).toBeVisible();
    await expect.element(region()).toBeVisible();
    await expect.element(portalButton()).toBeEnabled();
    expect(status().query()).toBeNull();
    expect(callsOf(ClientUltrasOfferDocument)).toHaveLength(1);
    expect(callsOf(ClientViewerUltrasDocument)).toHaveLength(1);
  });

  test('読み込み中は題名を残して読み込み中の状態を示す', async () => {
    executeGraphQL.mockReturnValue(new Promise(() => undefined));

    await renderPage();

    await expect.element(pageTitle()).toBeVisible();
    await expect.element(status()).toHaveTextContent('読み込み中');
    expect(region().query()).toBeNull();
  });

  test('Portalを開けない利用者には、ボタンを置かずに未加入の旨を示す', async () => {
    respondWithUltras(NEVER_SUBSCRIBED);

    await renderPage();

    await expect
      .element(page.getByText(NOT_SUBSCRIBED_MESSAGE, { exact: true }))
      .toBeVisible();
    expect(portalButton().query()).toBeNull();
  });

  test('Customer Portalから戻った直後は反映待ちの状態の文を示し、5秒後に加入状態の照会だけを取り直す', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    respondWithUltras(ACTIVE_ULTRAS);

    await renderPage(true);

    await expect.element(region()).toBeVisible();
    await expect.element(status()).toHaveTextContent(PENDING_MESSAGE);
    expect(callsOf(ClientViewerUltrasDocument)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(RECHECK_MS);

    await expect.poll(() => callsOf(ClientViewerUltrasDocument).length).toBe(2);
    expect(callsOf(ClientUltrasOfferDocument)).toHaveLength(1);
    await expect.element(status()).toHaveTextContent(PENDING_MESSAGE);
  });

  test('取得に失敗すると題名を残したまま再試行と問い合わせの導線を示し、再試行で描き直して題名へフォーカスを移す', async () => {
    respond([
      { ok: false, error: LOAD_FAILURE },
      { ok: true, data: ACTIVE_ULTRAS },
    ]);

    await renderPage();

    await expect.element(pageTitle()).toBeVisible();
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(LOAD_FAILURE.message);
    await expect
      .element(page.getByRole('link', { name: CONTACT_LABEL }))
      .toHaveAttribute('href', '/contact');
    expect(region().query()).toBeNull();

    await userEvent.click(retryButton());

    await expect.element(region()).toBeVisible();
    await expect.element(portalButton()).toBeEnabled();
    await expect.element(pageTitle()).toHaveFocus();
    expect(callsOf(ClientViewerUltrasDocument)).toHaveLength(2);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('加入中の表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWithUltras(ACTIVE_ULTRAS);
      await renderPage();
      await expect.element(portalButton()).toBeEnabled();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('反映待ちの表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWithUltras(ACTIVE_ULTRAS);
      await renderPage(true);
      await expect.element(status()).toHaveTextContent(PENDING_MESSAGE);
      await expect.element(portalButton()).toBeEnabled();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('取得の失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond([{ ok: false, error: LOAD_FAILURE }]);
      await renderPage();
      await expect.element(retryButton()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
