import { notifyManager } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { resetTurnstileScriptFailure } from '../lib/components/bot-protection/turnstile-script-failure.ts';
import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../lib/test/fake-turnstile.tsx';
import type { DisplayPreferences } from '../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import {
  MY_SPONSORSHIPS_NEXT_DAY_STARTS_AT,
  type MySponsorshipNode,
  mySponsorshipOf,
  mySponsorshipsOf,
  mySponsorshipsResult,
} from '../src/components/sponsorship/my-sponsorships-fixtures.ts';
import { BOUNDARY_REFRESH_DELAY_MS } from '../src/components/time/use-boundary-refresh.ts';
import {
  ClientMySponsorshipsDocument,
  type ClientMySponsorshipsQueryVariables,
  ClientResumeSponsorshipCheckoutDocument,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as SettingsRoute } from '../src/routes/_authenticated/settings/route.tsx';
import { Route as SponsorshipsSettingsRoute } from '../src/routes/_authenticated/settings/sponsorships.tsx';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const SPONSORSHIPS_PATH = '/settings/sponsorships';

const PAGE_SIZE = 20;

const PURCHASE_ID = '01JC0PURCHASE000000000001';

const LOAD_ERROR_MESSAGE =
  'スポンサー広告の一覧を読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const NOT_PAYABLE_MESSAGE =
  '掲載開始日を過ぎたため、この申込は決済できません。新しく申し込んでください。';

const LOAD_FAILURE = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const RATE_LIMITED = new GraphQLClientError({
  code: 'rate_limit_exceeded',
  message: '操作が集中しています。しばらくしてから再度お試しください。',
  status: 429,
});

const PENDING: MySponsorshipNode = mySponsorshipOf(1, {
  status: 'PENDING_PAYMENT',
  amountPaid: null,
  startsOn: '2026-11-20',
  endsOn: '2026-11-26',
  canResume: true,
});

const SCHEDULED: MySponsorshipNode = mySponsorshipOf(2, {
  status: 'SCHEDULED',
  startsOn: '2026-11-19',
  endsOn: '2026-11-25',
});

type ListResponder = (variables: ClientMySponsorshipsQueryVariables) => unknown;

const respond = (
  list: ListResponder,
  resume: () => Promise<unknown> = () =>
    Promise.resolve({
      ok: true,
      data: { resumeSponsorshipCheckout: { purchaseId: PURCHASE_ID } },
    }),
) => {
  executeGraphQL.mockImplementation(
    (document: unknown, variables: ClientMySponsorshipsQueryVariables) => {
      if (document === ClientMySponsorshipsDocument) {
        return Promise.resolve(list(variables));
      }
      if (document === ClientResumeSponsorshipCheckoutDocument) {
        return resume();
      }
      throw new Error('想定していない操作が実行されました。');
    },
  );
};

const respondWith = (nodes: readonly MySponsorshipNode[]) => {
  respond(() => mySponsorshipsResult(nodes));
};

const listCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientMySponsorshipsDocument,
  );

const resumeCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientResumeSponsorshipCheckoutDocument,
  );

// アプリの経路と同じ判定・レイアウト・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じIDの経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'settings',
    component: SettingsRoute.options.component,
  });
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/auth/login',
      component: () => <h1>ログイン</h1>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/pricing',
      component: () => <h1>料金</h1>,
    }),
    authenticatedRoute.addChildren([
      settingsRoute.addChildren([
        createRoute({
          getParentRoute: () => settingsRoute,
          path: 'sponsorships',
          loader: SponsorshipsSettingsRoute.options.loader,
          component: SponsorshipsSettingsRoute.options.component,
        } as Parameters<typeof createRoute>[0]),
      ]),
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/checkout/$purchaseId',
        component: () => <h1>お支払い</h1>,
      }),
    ]),
  ];
};

const renderSponsorships = async ({
  signedIn = true,
}: { readonly signedIn?: boolean } = {}) => {
  const router = await renderPageRouter({
    path: SPONSORSHIPS_PATH,
    createRoutes,
    context: createPageRouterContext('local'),
    ...(signedIn ? { cachedViewer: signedInViewerQuery() } : {}),
  });
  await render(<Toaster />);
  return router;
};

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const sponsorshipList = () =>
  main().getByRole('list', { name: 'スポンサー広告' });
const items = () => sponsorshipList().getByRole('listitem');
const itemOf = (name: string) =>
  items().filter({ has: page.getByRole('heading', { name }) });
const loadMoreButton = () => main().getByRole('button', { name: 'さらに表示' });
const resumeButton = () => main().getByRole('button', { name: /決済へ進む$/ });
const settingsNavigation = () => page.getByRole('navigation', { name: '設定' });

type PageHead = ReturnType<typeof buildSitePageHead>;

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、テストの後に既定の通知へ戻す
const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('自分の広告一覧の経路', () => {
  test('未ログインでは、自分の広告一覧のパスを戻り先にしたログイン画面へ移し、一覧を取得しない', async () => {
    const router = await renderSponsorships({ signedIn: false });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({
      redirect: SPONSORSHIPS_PATH,
    });
    expect(listCalls()).toHaveLength(0);
  });

  test('設定のナビゲーションの中に描き、「スポンサー広告」を現在の項目として示す', async () => {
    respondWith([SCHEDULED]);

    await renderSponsorships();

    await expect.element(pageTitle()).toHaveTextContent('スポンサー広告');
    await expect
      .element(
        settingsNavigation().getByRole('link', { name: 'スポンサー広告' }),
      )
      .toHaveAttribute('aria-current', 'page');
    await expect
      .element(
        settingsNavigation().getByRole('link', { name: 'スポンサー広告' }),
      )
      .toHaveAttribute('href', SPONSORSHIPS_PATH);
  });

  test('申込を応答の順(申込の新しい順)に、項目ごとに示す', async () => {
    respondWith([PENDING, SCHEDULED]);

    await renderSponsorships();

    await expect.poll(() => items().elements()).toHaveLength(2);
    await expect.element(items().nth(0)).toHaveTextContent('掲載状況未決済');
    await expect.element(items().nth(1)).toHaveTextContent('掲載状況掲載予定');
  });

  test('最初は20件を読み、「さらに表示」で続きの20件を後ろに加えて、加えた最初の申込へフォーカスを移す', async () => {
    const pending = deferred<unknown>();
    respond((variables) =>
      variables.after === undefined
        ? mySponsorshipsResult(mySponsorshipsOf(0, PAGE_SIZE), {
            endCursor: 'cursor-2',
          })
        : pending.promise,
    );

    await renderSponsorships();

    await expect.poll(() => items().elements()).toHaveLength(PAGE_SIZE);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientMySponsorshipsDocument,
      { first: PAGE_SIZE },
      expect.anything(),
    );

    await userEvent.click(loadMoreButton());

    const busy = main().getByRole('button', { name: '読み込み中' });
    await expect.element(busy).toHaveAttribute('aria-busy', 'true');
    await expect.element(busy).toHaveAttribute('aria-disabled', 'true');
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientMySponsorshipsDocument,
      { first: PAGE_SIZE, after: 'cursor-2' },
      expect.anything(),
    );

    pending.resolve(
      mySponsorshipsResult(mySponsorshipsOf(PAGE_SIZE, PAGE_SIZE), {
        endCursor: 'cursor-3',
      }),
    );

    await expect.poll(() => items().elements()).toHaveLength(PAGE_SIZE * 2);
    await expect.element(items().nth(PAGE_SIZE)).toHaveFocus();
    await expect.element(loadMoreButton()).toBeVisible();
  });

  test('最後のページを読み込むと「さらに表示」を消し、フォーカスを加えた最初の申込へ移す', async () => {
    respond((variables) =>
      variables.after === undefined
        ? mySponsorshipsResult([SCHEDULED], { endCursor: 'cursor-2' })
        : mySponsorshipsResult([PENDING]),
    );

    await renderSponsorships();
    await userEvent.click(loadMoreButton());

    await expect.poll(() => items().elements()).toHaveLength(2);
    await expect.element(items().nth(1)).toHaveFocus();
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('続きが無ければ「さらに表示」を置かない', async () => {
    respondWith([SCHEDULED]);

    await renderSponsorships();

    await expect.poll(() => items().elements()).toHaveLength(1);
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('続きの読み込みの失敗は読み込んだ申込を残したまま示し、「さらに表示」で読み込み直せる', async () => {
    let failing = true;
    respond((variables) =>
      variables.after === undefined
        ? mySponsorshipsResult([SCHEDULED], { endCursor: 'cursor-2' })
        : failing
          ? { ok: false, error: LOAD_FAILURE }
          : mySponsorshipsResult([PENDING]),
    );

    await renderSponsorships();
    await userEvent.click(loadMoreButton());

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(LOAD_ERROR_MESSAGE);
    expect(items().elements()).toHaveLength(1);
    await expect.element(loadMoreButton()).toHaveFocus();

    failing = false;
    await userEvent.click(loadMoreButton());

    await expect.poll(() => items().elements()).toHaveLength(2);
    expect(main().getByRole('alert').elements()).toHaveLength(0);
  });

  test('申込が0件なら、申込が無い旨と料金ページのスポンサー広告の区画への導線を示す', async () => {
    respondWith([]);

    await renderSponsorships();

    await expect
      .element(main().getByText('まだスポンサー広告の申込はありません。'))
      .toBeVisible();
    await expect
      .element(main().getByRole('link', { name: 'スポンサー広告を申し込む' }))
      .toHaveAttribute('href', '/pricing#sponsorship');
    expect(sponsorshipList().elements()).toHaveLength(0);
  });

  test('最初の読み込みの失敗は見出しを残したまま固定の文言と再試行を示し、再試行で見出しへフォーカスを移して取得し直す', async () => {
    let failing = true;
    respond(() =>
      failing
        ? { ok: false, error: LOAD_FAILURE }
        : mySponsorshipsResult([SCHEDULED]),
    );

    await renderSponsorships();

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(LOAD_ERROR_MESSAGE);
    await expect.element(pageTitle()).toHaveTextContent('スポンサー広告');

    failing = false;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(items().first()).toHaveTextContent('掲載予定');
    await expect.element(pageTitle()).toHaveFocus();
  });

  test('表示中に基準時刻の0:00を迎えると、その時刻に取り直して掲載状況を切り替える', async () => {
    notifyManager.setScheduler(queueMicrotask);
    const boundary = new Date(MY_SPONSORSHIPS_NEXT_DAY_STARTS_AT).getTime();
    vi.useFakeTimers({
      now: new Date(boundary - 60_000),
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    let started = false;
    respond(() =>
      started
        ? mySponsorshipsResult([{ ...SCHEDULED, status: 'ACTIVE' }], {
            nextDayStartsAt: '2026-11-20T08:00:00.000Z',
          })
        : mySponsorshipsResult([SCHEDULED]),
    );

    await renderSponsorships();
    await expect.element(items().first()).toHaveTextContent('掲載状況掲載予定');

    started = true;
    await vi.advanceTimersByTimeAsync(60_000 + BOUNDARY_REFRESH_DELAY_MS - 1);
    expect(listCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect.element(items().first()).toHaveTextContent('掲載状況掲載中');
    expect(listCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(listCalls()).toHaveLength(2);
  });

  test('「決済へ進む」は画面に表示しないbot判定の結果を添えて決済を再開し、決済画面へ移る', async () => {
    respondWith([PENDING]);

    const router = await renderSponsorships();
    await expect.element(resumeButton()).toBeVisible();
    expect(lastTurnstileProps().options?.action).toBe('sponsorship_apply');
    expect(lastTurnstileProps().options?.size).toBe('invisible');
    await userEvent.click(
      page.getByRole('button', { name: '判定を成功させる', exact: true }),
    );

    await userEvent.click(resumeButton());

    await expect.element(pageTitle()).toHaveTextContent('お支払い');
    expect(router.state.location.pathname).toBe(`/checkout/${PURCHASE_ID}`);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientResumeSponsorshipCheckoutDocument,
      { id: PENDING.id },
      expect.objectContaining({ turnstileToken: 'turnstile-token-1' }),
    );
  });

  test('決済を再開する間はボタンを「送信中」にして二重に送らない', async () => {
    const pending = deferred<unknown>();
    respond(
      () => mySponsorshipsResult([PENDING]),
      () => pending.promise,
    );

    await renderSponsorships();
    await userEvent.click(resumeButton());

    const busy = main().getByRole('button', { name: '送信中' });
    await expect.element(busy).toHaveAttribute('aria-busy', 'true');
    await expect.element(busy).toHaveAttribute('aria-disabled', 'true');
    // 処理中のボタンはポインターの操作を受けないため、要素のclickで押して二重に送らないことを確かめる
    (busy.element() as HTMLElement).click();

    pending.resolve({
      ok: true,
      data: { resumeSponsorshipCheckout: { purchaseId: PURCHASE_ID } },
    });

    await expect.element(pageTitle()).toHaveTextContent('お支払い');
    expect(resumeCalls()).toHaveLength(1);
  });

  test('開始日を過ぎていて決済できなければ、開始日の経過の文言を通知し、一覧を取り直して項目へフォーカスを移す', async () => {
    let expired = false;
    respond(
      () =>
        mySponsorshipsResult([
          expired ? { ...PENDING, canResume: false } : PENDING,
        ]),
      () => {
        expired = true;
        return Promise.resolve({
          ok: false,
          error: new GraphQLClientError({
            code: 'sponsorship_not_payable',
            message: '決済できません。',
            status: 409,
          }),
        });
      },
    );

    const router = await renderSponsorships();
    await userEvent.click(resumeButton());

    await expect.element(page.getByText(NOT_PAYABLE_MESSAGE)).toBeVisible();
    await expect.poll(() => listCalls()).toHaveLength(2);
    await expect.poll(() => resumeButton().elements()).toHaveLength(0);
    await expect.element(itemOf('Pitch Notes')).toHaveFocus();
    expect(router.state.location.pathname).toBe(SPONSORSHIPS_PATH);
  });

  test('日次の処理で消えた申込なら、見つからない旨を通知し、取り直した一覧から項目が消えると見出しへフォーカスを移す', async () => {
    const other = mySponsorshipOf(2, {
      status: 'SCHEDULED',
      product: {
        handle: 'other_product',
        name: 'Other Product',
        listed: true,
        logo: null,
      },
    });
    let purged = false;
    respond(
      () => mySponsorshipsResult(purged ? [other] : [PENDING, other]),
      () => {
        purged = true;
        return Promise.resolve({
          ok: false,
          error: new GraphQLClientError({
            code: 'sponsorship_not_found',
            message: '見つかりません。',
            status: 404,
          }),
        });
      },
    );

    await renderSponsorships();
    await userEvent.click(resumeButton());

    await expect
      .element(page.getByText('この申込は見つかりませんでした。'))
      .toBeVisible();
    await expect.poll(() => items().elements()).toHaveLength(1);
    await expect.element(pageTitle()).toHaveFocus();
  });

  test('決済サービスの障害では、ボタンを無効にして縮退の注記を示す', async () => {
    respond(
      () => mySponsorshipsResult([PENDING]),
      () =>
        Promise.resolve({
          ok: false,
          error: new GraphQLClientError({
            code: 'payments_unavailable',
            message: '決済を利用できません。',
            status: 503,
          }),
        }),
    );

    await renderSponsorships();
    await userEvent.click(resumeButton());

    await expect.element(resumeButton()).toBeDisabled();
    await expect
      .element(resumeButton())
      .toHaveAccessibleDescription(/決済サービスで障害が発生しています。/u);
  });

  test('その他の失敗は、ボタンの近くに理由を示して一覧に留まる', async () => {
    respond(
      () => mySponsorshipsResult([PENDING]),
      () => Promise.resolve({ ok: false, error: RATE_LIMITED }),
    );

    const router = await renderSponsorships();
    await userEvent.click(resumeButton());

    await expect
      .element(itemOf('Pitch Notes').getByRole('alert'))
      .toHaveTextContent(RATE_LIMITED.message);
    await expect.element(resumeButton()).toBeEnabled();
    expect(router.state.location.pathname).toBe(SPONSORSHIPS_PATH);
  });

  test('自分の広告一覧のページのタイトルは「スポンサー広告」で、検索エンジンに登録させない', () => {
    const head = SponsorshipsSettingsRoute.options.head as
      (() => PageHead) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: 'スポンサー広告 | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('一覧と続きの読み込みの表示で、アクセシビリティの検査の違反が0件', async () => {
      respond(() =>
        mySponsorshipsResult([PENDING, SCHEDULED], { endCursor: 'cursor-2' }),
      );
      await renderSponsorships();
      await expect.element(loadMoreButton()).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('0件の表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWith([]);
      await renderSponsorships();
      await expect
        .element(main().getByText('まだスポンサー広告の申込はありません。'))
        .toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('読み込みの失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond(() => ({ ok: false, error: LOAD_FAILURE }));
      await renderSponsorships();
      await expect.element(main().getByRole('alert')).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });
  });
});
