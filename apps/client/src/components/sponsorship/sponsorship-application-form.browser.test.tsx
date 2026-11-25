import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../../../lib/test/fake-turnstile.tsx';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import {
  computePeriodWindows,
  type SponsorshipDatePeriod,
  type SponsorshipDateWindow,
} from '../../../common-lib/sponsorship/sponsorship-period.ts';
import { SPONSORSHIP_PURCHASE_CONDITIONS } from '../../../common-lib/sponsorship/sponsorship-purchase-conditions.ts';
import { addBusinessDays } from '../../../common-lib/time/business-date-arithmetic.ts';
import {
  createPageRouterContext,
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { PRICING_SECTIONS } from '../../composition/pricing-sections.ts';
import {
  ClientApplySponsorshipDocument,
  ClientSponsorshipOfferDocument,
  type ClientSponsorshipOfferQuery,
  ClientSponsorshipPeriodWindowDocument,
  type ClientSponsorshipPeriodWindowQuery,
  type ClientSponsorshipPeriodWindowQueryVariables,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { PricingPage } from '../ultras/pricing-page.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

// 業務日付2026-11-18の12:00(UTC-08:00)
const NOW = new Date('2026-11-18T20:00:00.000Z');

const PRODUCT_ID = '01JD0PR0DVCT000000000000000';
const OTHER_PRODUCT_ID = '01JD0PR0DVCT000000000000001';
const PRODUCT_NAME = 'ピッチデッキ工房';
const OTHER_PRODUCT_NAME = 'ローンチ日記';
const PURCHASE_ID = '01JD0PVRCHASE00000000000000';

const SECTION_TITLE = 'スポンサー広告';
const FORM_NAME = 'スポンサー広告を申し込む';
const PRODUCT_LABEL = 'プロダクト(必須)';
const START_LABEL = '開始日(必須)';
const END_LABEL = '終了日(必須)';
const SUBMIT_LABEL = '申し込む';
const PENDING_LABEL = '送信中';
const LOGIN_LABEL = 'ログインして申し込む';
const PRICE_UNAVAILABLE = '現在表示できません';
const NO_ELIGIBLE_MESSAGE =
  'スポンサー広告を申し込めるプロダクトがありません。ローンチ日を迎えたプロダクトから選べます。';
const MY_PRODUCTS_LABEL = '自分のプロダクトを見る';
const EMAIL_UNVERIFIED_REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';
const SUSPENDED_REASON =
  'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。';
const PAYMENTS_UNAVAILABLE_REASON =
  '決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';
const INELIGIBLE_MESSAGE = 'このプロダクトはスポンサー広告を申し込めません。';
const OVERLAP_MESSAGE =
  'このプロダクトは選んだ期間に同じティアの広告を掲載中または掲載予定です。期間を変えて申し込んでください。';
const OVERLAP_REASON = '同じティアの広告の掲載期間と重なるため選べません。';
const START_REASON = '開始日は今日から1年以内の日付を選んでください。';
const RATE_LIMIT_MESSAGE =
  '操作が集中しています。しばらく時間をおいて再度お試しください。';
const BOT_FAILED_MESSAGE =
  '認証に失敗しました。ページを再読み込みして再度お試しください。';

const VERIFIED_VIEWER = signedInViewerQuery();

const PAID_PERIOD: SponsorshipDatePeriod = {
  startsOn: '2026-11-28',
  endsOn: '2026-12-04',
};

type TierAmounts = readonly [number | null, number | null, number | null];

const offerOf = (
  amounts: TierAmounts,
  products: ClientSponsorshipOfferQuery['sponsorshipOffer']['eligibleProducts'],
): ClientSponsorshipOfferQuery => ({
  sponsorshipOffer: {
    tiers: (['LEGEND', 'GOLD', 'SILVER'] as const).map((tier, index) => {
      const amount = amounts[index] ?? null;
      return {
        tier,
        unitPrice: amount === null ? null : { amount, currency: 'usd' },
      };
    }),
    eligibleProducts: products,
  },
});

const ELIGIBLE_PRODUCTS = [
  { id: PRODUCT_ID, handle: 'pitch-deck', name: PRODUCT_NAME, logo: null },
  {
    id: OTHER_PRODUCT_ID,
    handle: 'launch-diary',
    name: OTHER_PRODUCT_NAME,
    logo: null,
  },
];

const PRICED_AMOUNTS: TierAmounts = [5000, 2000, 550];

type ApplyOutcome = string | Error;

let offer: ClientSponsorshipOfferQuery = offerOf(
  PRICED_AMOUNTS,
  ELIGIBLE_PRODUCTS,
);
let paidPeriods: readonly SponsorshipDatePeriod[] = [PAID_PERIOD];
let applyOutcomes: ApplyOutcome[] = [];
let onApply: () => void = () => undefined;

const toView = ({ earliest, latest, unavailable }: SponsorshipDateWindow) => ({
  earliest,
  latest,
  unavailable: unavailable.map(({ from, to }) => ({
    from,
    to,
    reason: 'OVERLAP' as const,
  })),
});

const SERVER_TODAY = '2026-11-18';

const periodWindowOf = (
  variables: ClientSponsorshipPeriodWindowQueryVariables,
): ClientSponsorshipPeriodWindowQuery => {
  const windows = computePeriodWindows({
    today: SERVER_TODAY,
    startsOn: variables.startsOn ?? null,
    paidPeriods,
  });
  return {
    sponsorshipPeriodWindow: {
      businessToday: SERVER_TODAY,
      nextDayStartsAt: `${addBusinessDays(SERVER_TODAY, 1)}T08:00:00.000Z`,
      start: toView(windows.start),
      end: windows.end === null ? null : toView(windows.end),
    },
  };
};

// 申込は呼ぶたびに先頭の結果を返し、最後の結果は返し続ける。GraphQLClientError以外の例外は取得の失敗として投げる
const applyResult = (): Promise<unknown> => {
  onApply();
  const next =
    (applyOutcomes.length > 1 ? applyOutcomes.shift() : applyOutcomes[0]) ??
    PURCHASE_ID;
  if (next instanceof GraphQLClientError) {
    return Promise.resolve({ ok: false, error: next });
  }
  if (next instanceof Error) {
    return Promise.reject(next);
  }
  return Promise.resolve({
    ok: true,
    data: { applySponsorship: { purchaseId: next } },
  });
};

const respond = (document: unknown, variables: unknown) => {
  if (document === ClientSponsorshipOfferDocument) {
    return Promise.resolve({ ok: true, data: offer });
  }
  if (document === ClientSponsorshipPeriodWindowDocument) {
    return Promise.resolve({
      ok: true,
      data: periodWindowOf(
        variables as ClientSponsorshipPeriodWindowQueryVariables,
      ),
    });
  }
  if (document === ClientApplySponsorshipDocument) {
    return applyResult();
  }
  return Promise.reject(new Error('想定外の文書の取得'));
};

const failureOf = (code: string, status: number, message: string) =>
  new GraphQLClientError({ code, message, status });

const callsOf = (document: unknown) =>
  executeGraphQL.mock.calls.filter(([called]) => called === document);

const SPONSORSHIP_SECTIONS = PRICING_SECTIONS.filter(
  ({ id }) => id === 'sponsorship.sponsorship-pricing',
);

const renderSection = async (
  viewerQuery: ClientViewerQuery = VERIFIED_VIEWER,
) =>
  renderInRouter(
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <TooltipProvider>
        <main>
          <PricingPage sections={SPONSORSHIP_SECTIONS} />
        </main>
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    {
      context: createPageRouterContext('local'),
      cachedViewer: viewerQuery,
    },
  );

const region = () => page.getByRole('region', { name: SECTION_TITLE });
const form = () => page.getByRole('form', { name: FORM_NAME });
const submitButton = () =>
  page.getByRole('button', { name: SUBMIT_LABEL, exact: true });
const pendingButton = () =>
  page.getByRole('button', { name: PENDING_LABEL, exact: true });
const startDay = (name: string) =>
  page
    .getByRole('group', { name: START_LABEL })
    .getByRole('button', { name, exact: true });
const endDay = (name: string) =>
  page
    .getByRole('group', { name: END_LABEL })
    .getByRole('button', { name, exact: true });

const chooseProduct = async (name: string) => {
  await userEvent.click(page.getByRole('combobox', { name: PRODUCT_LABEL }));
  await userEvent.click(page.getByRole('option', { name, exact: true }));
};

const chooseTier = async (name: string) => {
  await userEvent.click(page.getByRole('radio', { name, exact: true }));
};

const passBotCheck = async () => {
  await userEvent.click(
    page.getByRole('button', { name: '判定を成功させる', exact: true }),
  );
};

// プロダクト・Gold・2026-11-20〜2026-11-26(7日間)を選ぶ
const fillPeriod = async () => {
  await chooseProduct(PRODUCT_NAME);
  await chooseTier('Gold');
  await userEvent.click(startDay('2026年11月20日金曜日'));
  await userEvent.click(endDay('2026年11月26日木曜日'));
};

const describedTexts = (element: Element): readonly string[] =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => document.getElementById(id)?.textContent ?? '');

beforeEach(async () => {
  offer = offerOf(PRICED_AMOUNTS, ELIGIBLE_PRODUCTS);
  paidPeriods = [PAID_PERIOD];
  applyOutcomes = [PURCHASE_ID];
  onApply = () => undefined;
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation(respond);
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  vi.useRealTimers();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('申込のフォームを出さない閲覧者', () => {
  test('未ログインの閲覧者には、価格と説明の後に、料金ページへ戻るログインへの導線「ログインして申し込む」だけを示す', async () => {
    offer = offerOf(PRICED_AMOUNTS, null);
    await renderSection(GUEST_VIEWER_QUERY);

    const login = region().getByRole('link', { name: LOGIN_LABEL });
    await expect.element(login).toBeVisible();
    await expect
      .element(login)
      .toHaveAttribute('href', '/auth/login?redirect=%2Fpricing');
    await expect.element(form()).not.toBeInTheDocument();
    expect(callsOf(ClientSponsorshipPeriodWindowDocument)).toHaveLength(0);
  });

  test.each([
    {
      label: 'メールアドレスが未確認',
      viewer: signedInViewerQuery({ emailVerified: false }),
      reason: EMAIL_UNVERIFIED_REASON,
    },
    {
      label: '停止中',
      viewer: signedInViewerQuery({ status: 'SUSPENDED' }),
      reason: SUSPENDED_REASON,
    },
  ])(
    '$labelの利用者には、無効の申込のボタンと理由の文言を示す',
    async ({ viewer, reason }) => {
      await renderSection(viewer);

      await expect.element(submitButton()).toBeDisabled();
      await expect.element(region().getByText(reason)).toBeVisible();
      expect(describedTexts(submitButton().element())).toEqual([reason]);
      await expect.element(form()).not.toBeInTheDocument();
    },
  );

  test('申込の対象のプロダクトが無い利用者には、案内と自分のプロダクトの画面への導線を示す', async () => {
    offer = offerOf(PRICED_AMOUNTS, []);
    await renderSection();

    await expect
      .element(region().getByText(NO_ELIGIBLE_MESSAGE, { exact: true }))
      .toBeVisible();
    await expect
      .element(region().getByRole('link', { name: MY_PRODUCTS_LABEL }))
      .toHaveAttribute('href', '/my/products');
    await expect.element(form()).not.toBeInTheDocument();
  });
});

describe('申込のフォーム', () => {
  test('プロダクト・ティア・掲載期間・返金の扱いの注記・申込のボタンを順に示し、プロダクトは名称で選べる', async () => {
    await renderSection();

    await expect.element(form()).toBeVisible();
    await expect
      .element(page.getByRole('combobox', { name: PRODUCT_LABEL }))
      .toHaveTextContent('選択してください');
    await expect
      .element(page.getByRole('radiogroup', { name: 'ティア(必須)' }))
      .toBeVisible();
    for (const condition of SPONSORSHIP_PURCHASE_CONDITIONS) {
      await expect
        .element(form().getByText(condition, { exact: true }))
        .toBeVisible();
    }
    await expect.element(submitButton()).toBeDisabled();

    await userEvent.click(page.getByRole('combobox', { name: PRODUCT_LABEL }));
    await expect
      .element(page.getByRole('option', { name: OTHER_PRODUCT_NAME }))
      .toBeVisible();
    await userEvent.click(page.getByRole('option', { name: PRODUCT_NAME }));
    await expect
      .element(page.getByRole('combobox', { name: PRODUCT_LABEL }))
      .toHaveTextContent(PRODUCT_NAME);
    expect(lastTurnstileProps().options?.action).toBe('sponsorship_apply');
    expect(lastTurnstileProps().options?.size).toBe('invisible');
  });

  test('申込のボタンは、プロダクト・ティア・開始日・終了日を全て選ぶまで無効で、選ぶと日数と合計を示して有効になる', async () => {
    await renderSection();

    await chooseProduct(PRODUCT_NAME);
    await expect.element(submitButton()).toBeDisabled();
    await chooseTier('Gold');
    await expect.element(submitButton()).toBeDisabled();
    await userEvent.click(startDay('2026年11月20日金曜日'));
    await expect.element(submitButton()).toBeDisabled();
    await expect
      .element(form().getByText('日数', { exact: true }))
      .not.toBeInTheDocument();
    await userEvent.click(endDay('2026年11月26日木曜日'));

    await expect.element(submitButton()).toBeEnabled();
    const summary = form().getByRole('definition');
    await expect.element(summary.nth(0)).toHaveTextContent('7日間');
    await expect.element(summary.nth(1)).toHaveTextContent('$140.00');
    await expect.element(form().getByText('合計(税込)')).toBeVisible();

    await chooseTier('Silver');
    await expect.element(summary.nth(1)).toHaveTextContent('$38.50');
  });

  test('選んだティアの価格を照会できないときは、合計の位置に「現在表示できません」を示し、申込のボタンを無効にしてその文言を結ぶ', async () => {
    offer = offerOf([5000, null, 550], ELIGIBLE_PRODUCTS);
    await renderSection();

    await fillPeriod();

    await expect.element(form().getByText('7日間')).toBeVisible();
    await expect
      .element(form().getByRole('definition').nth(1))
      .toHaveTextContent(PRICE_UNAVAILABLE);
    await expect.element(submitButton()).toBeDisabled();
    expect(describedTexts(submitButton().element())).toEqual([
      PRICE_UNAVAILABLE,
    ]);
  });

  test('送信するとbot判定のトークンを添えて申し込み、返った購入の決済画面へ移る。送信中はボタンをaria-disabled・aria-busyにする', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const router = await renderSection();
    await fillPeriod();
    await passBotCheck();
    executeGraphQL.mockImplementation((document: unknown, variables) =>
      document === ClientApplySponsorshipDocument
        ? gate.then(() => applyResult())
        : respond(document, variables),
    );

    await userEvent.click(submitButton());

    await expect
      .element(pendingButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(pendingButton()).toHaveAttribute('aria-busy', 'true');
    release();
    await expect
      .poll(() => router.state.location.pathname)
      .toBe(`/checkout/${PURCHASE_ID}`);
    const calls = callsOf(ClientApplySponsorshipDocument);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toStrictEqual({
      input: {
        productId: PRODUCT_ID,
        tier: 'GOLD',
        startsOn: '2026-11-20',
        endsOn: '2026-11-26',
      },
    });
    expect(calls[0]?.[2]).toStrictEqual({
      turnstileToken: 'turnstile-token-1',
    });
  });

  test('決済サービスの障害(payments_unavailable)を受けたら、縮退の注記を示し申込のボタンを無効にして注記を結ぶ', async () => {
    applyOutcomes = [
      failureOf(
        'payments_unavailable',
        503,
        `現在、決済をご利用いただけません。${PAYMENTS_UNAVAILABLE_REASON}`,
      ),
    ];
    const router = await renderSection();
    await fillPeriod();
    await passBotCheck();

    await userEvent.click(submitButton());

    await expect
      .element(
        form().getByRole('status').getByText(PAYMENTS_UNAVAILABLE_REASON),
      )
      .toBeVisible();
    await expect.element(submitButton()).toBeDisabled();
    expect(
      describedTexts(submitButton().element()).some((text) =>
        text.includes(PAYMENTS_UNAVAILABLE_REASON),
      ),
    ).toBe(true);
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('申込の失敗の文言', () => {
  test('対象外のプロダクト(sponsorship_product_ineligible)は、フォームの上部に文言を示す', async () => {
    applyOutcomes = [
      failureOf('sponsorship_product_ineligible', 422, INELIGIBLE_MESSAGE),
    ];
    await renderSection();
    await fillPeriod();
    await passBotCheck();

    await userEvent.click(submitButton());

    const alert = form().getByRole('alert');
    await expect.element(alert).toHaveTextContent(INELIGIBLE_MESSAGE);
    expect(
      alert
        .element()
        .compareDocumentPosition(
          page.getByRole('combobox', { name: PRODUCT_LABEL }).element(),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('掲載期間の重なり(sponsorship_overlap)は、フォームの上部に文言を示して選べる範囲を取り直し、重なった終了日に理由を示して申込のボタンを無効にする', async () => {
    applyOutcomes = [failureOf('sponsorship_overlap', 409, OVERLAP_MESSAGE)];
    await renderSection();
    await fillPeriod();
    await passBotCheck();
    const windowCallsBefore = callsOf(
      ClientSponsorshipPeriodWindowDocument,
    ).length;
    onApply = () => {
      paidPeriods = [
        PAID_PERIOD,
        { startsOn: '2026-11-24', endsOn: '2026-11-25' },
      ];
    };

    await userEvent.click(submitButton());

    await expect
      .element(form().getByRole('alert'))
      .toHaveTextContent(OVERLAP_MESSAGE);
    await expect
      .poll(() => callsOf(ClientSponsorshipPeriodWindowDocument).length)
      .toBeGreaterThan(windowCallsBefore);
    await expect
      .element(endDay(`2026年11月26日木曜日、選択済み、${OVERLAP_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(submitButton()).toBeDisabled();
  });

  test('取り直しで選んだ開始日が選べなくなり終了日の範囲が返らないときは、開始日に理由を示し申込のボタンを無効にする', async () => {
    applyOutcomes = [failureOf('sponsorship_overlap', 409, OVERLAP_MESSAGE)];
    await renderSection();
    await fillPeriod();
    await passBotCheck();
    onApply = () => {
      paidPeriods = [
        PAID_PERIOD,
        { startsOn: '2026-11-19', endsOn: '2026-11-21' },
      ];
    };

    await userEvent.click(submitButton());

    await expect
      .element(startDay(`2026年11月20日金曜日、選択済み、${OVERLAP_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(page.getByRole('group', { name: END_LABEL }))
      .not.toBeInTheDocument();
    await expect.element(submitButton()).toBeDisabled();
  });

  test.each([
    {
      code: 'rate_limit_exceeded',
      status: 429,
      message: RATE_LIMIT_MESSAGE,
    },
    {
      code: 'email_not_verified',
      status: 403,
      message: EMAIL_UNVERIFIED_REASON,
    },
    {
      code: 'account_unavailable',
      status: 403,
      message: SUSPENDED_REASON,
    },
  ])(
    'その他の失敗($code)は、申込のボタンの近くにサーバーの文言を示し、ボタンに結ぶ',
    async ({ code, status, message }) => {
      applyOutcomes = [failureOf(code, status, message)];
      await renderSection();
      await fillPeriod();
      await passBotCheck();

      await userEvent.click(submitButton());

      await expect
        .element(form().getByRole('alert'))
        .toHaveTextContent(message);
      expect(describedTexts(submitButton().element())).toContain(message);
      expect(
        submitButton()
          .element()
          .compareDocumentPosition(form().getByRole('alert').element()) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  test('bot判定の失敗(bot_verification_failed)が送り直しでも続くときは、認証の失敗の文言を示す', async () => {
    applyOutcomes = [
      failureOf('bot_verification_failed', 403, BOT_FAILED_MESSAGE),
    ];
    await renderSection();
    await fillPeriod();
    await passBotCheck();

    await userEvent.click(submitButton());
    await expect
      .poll(() => callsOf(ClientApplySponsorshipDocument).length)
      .toBe(1);
    await passBotCheck();

    await expect
      .element(form().getByRole('alert'))
      .toHaveTextContent(BOT_FAILED_MESSAGE);
    expect(callsOf(ClientApplySponsorshipDocument)).toHaveLength(2);
  });

  test('GraphQLClientErrorでない例外は、想定外の失敗の文言を示す', async () => {
    applyOutcomes = [new TypeError('Failed to fetch')];
    await renderSection();
    await fillPeriod();
    await passBotCheck();

    await userEvent.click(submitButton());

    await expect
      .element(form().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE);
  });

  test('掲載期間の違反(validation_error)の欄の詳細は、その欄に文言を示す', async () => {
    applyOutcomes = [
      new GraphQLClientError({
        code: 'validation_error',
        message: '入力内容を確認してください。',
        status: 400,
        details: [
          {
            field: 'input.startsOn',
            code: 'too_far',
            message: START_REASON,
          },
        ],
      }),
    ];
    await renderSection();
    await fillPeriod();
    await passBotCheck();

    await userEvent.click(submitButton());

    const startGroup = page.getByRole('group', { name: START_LABEL });
    await expect
      .poll(() => describedTexts(startGroup.element()))
      .toContain(START_REASON);
    expect(form().getByRole('alert').query()).toBeNull();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test('期間と合計を選んだ申込のフォームで、アクセシビリティの検査の違反が0件', async () => {
    await renderSection();
    await fillPeriod();
    await expect.element(submitButton()).toBeEnabled();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('決済サービスの障害の注記と、選び直したティアの価格を照会できない合計の位置の文言を示したフォームで、アクセシビリティの検査の違反が0件', async () => {
    offer = offerOf([5000, 2000, null], ELIGIBLE_PRODUCTS);
    applyOutcomes = [
      failureOf(
        'payments_unavailable',
        503,
        `現在、決済をご利用いただけません。${PAYMENTS_UNAVAILABLE_REASON}`,
      ),
    ];
    await renderSection();
    await fillPeriod();
    await passBotCheck();
    await userEvent.click(submitButton());
    await expect
      .element(
        form().getByRole('status').getByText(PAYMENTS_UNAVAILABLE_REASON),
      )
      .toBeVisible();
    await chooseTier('Silver');
    await expect
      .element(form().getByRole('definition').nth(1))
      .toHaveTextContent(PRICE_UNAVAILABLE);
    const described = describedTexts(submitButton().element());
    expect(described).toContain(PRICE_UNAVAILABLE);
    expect(
      described.some((text) => text.includes(PAYMENTS_UNAVAILABLE_REASON)),
    ).toBe(true);

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test.each([
    { label: '未ログイン', viewer: GUEST_VIEWER_QUERY },
    {
      label: 'メールアドレス未確認',
      viewer: signedInViewerQuery({ emailVerified: false }),
    },
  ])(
    '$labelの閲覧者の区画で、アクセシビリティの検査の違反が0件',
    async ({ viewer }) => {
      offer = offerOf(PRICED_AMOUNTS, viewer.viewer === null ? null : []);
      await renderSection(viewer);
      await expect.element(region()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
