import { mutationOptions, notifyManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  tokenColorOf,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { ClientUltrasOfferDocument } from '../../graphql/generated/graphql.ts';
import {
  ALIVE_ENTRY,
  CHAMPION_ENTRY,
  CLOSED_AWAITING_ENTRY,
  ELIMINATED_ENTRY,
  ENTRY_ACCEPT_UNTIL,
  ENTRY_BRACKET_PATH,
  ENTRY_BUTTON_LABEL,
  ENTRY_CHAMPION_MESSAGE,
  ENTRY_CLOSED_MESSAGE,
  ENTRY_COPY,
  ENTRY_DRAW_AT,
  ENTRY_DRAWN_MESSAGE,
  ENTRY_EXCLUDED_REFUND_SUFFIX,
  ENTRY_EXEMPT_MESSAGE,
  ENTRY_FORFEITED_MESSAGE,
  ENTRY_FORFEITED_REFUND_SUFFIX,
  ENTRY_LAUNCH_ID,
  ENTRY_PURCHASE_ID,
  ENTRY_TITLE,
  entryInputOf,
  excludedEntryOf,
  EXEMPT_AWAITING_ENTRY,
  expiredEntryOf,
  forfeitedEntryOf,
  PAID_ENTITLED_ENTRY,
  PRODUCT_UNAVAILABLE_ENTRY,
  PRODUCT_UNAVAILABLE_MESSAGE,
  SERVER_TIME_48_HOURS_BEFORE,
  SERVER_TIME_THREE_DAYS_BEFORE,
  serverTimeBeforeAcceptUntil,
  ULTRAS_ENTITLED_ENTRY,
} from './tournament-entry-fixtures.ts';
import type { TournamentEntryInput } from './tournament-entry-model.ts';
import { TournamentEntryPanelBody } from './tournament-entry-panel-body.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKYO_JA = { timeZone: 'Asia/Tokyo', locale: 'ja-JP' } as const;

const SECOND_MS = 1000;
const HOUR_MS = 3_600_000;

const BUTTON_NAME = new RegExp(`^${ENTRY_BUTTON_LABEL}`, 'u');

const UNAVAILABLE_REASON =
  '決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';

const ULTRAS_GUIDE =
  'Ultrasなら参加費が免除され、敗北後は2日で再ローンチできます。料金を見る';

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、テストの後に既定の通知へ戻す
const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

interface CheckoutResult {
  readonly purchaseId: string;
}

const startCheckout =
  vi.fn<
    (input: {
      readonly variables: { readonly launchId: string };
    }) => Promise<CheckoutResult>
  >();

const CHECKOUT = Object.freeze({
  mutationOptions: mutationOptions({
    mutationKey: ['test-entry-checkout'],
    mutationFn: startCheckout,
  }),
  purchaseIdOf: (data: CheckoutResult) => data.purchaseId,
});

const respondOffer = (promotionEnabled = true): void => {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientUltrasOfferDocument) {
      return Promise.resolve({
        ok: true,
        data: {
          ultrasOffer: {
            price: { amount: 999, currency: 'usd' },
            priceStale: false,
            promotionEnabled,
          },
        },
      });
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

const failureOf = (code: string, status: number, message: string) =>
  new GraphQLClientError({ code, message, status });

interface RenderOptions {
  readonly countdown?: boolean;
  readonly autoRefresh?: boolean;
  readonly onBoundaryReached?: () => void;
  readonly onAutoUpdatingChange?: (active: boolean) => void;
  readonly payableIntro?: ReactNode;
}

const renderBody = async (
  entry: TournamentEntryInput | null,
  {
    countdown = true,
    autoRefresh = true,
    onBoundaryReached = vi.fn(),
    onAutoUpdatingChange,
    payableIntro,
  }: RenderOptions = {},
) => {
  await emulateBrowserDisplay(TOKYO_JA);
  return renderInRouter(
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <main>
        <TournamentEntryPanelBody
          entry={entry}
          copy={ENTRY_COPY}
          countdown={countdown}
          autoRefresh={autoRefresh}
          checkout={CHECKOUT}
          onBoundaryReached={onBoundaryReached}
          onAutoUpdatingChange={onAutoUpdatingChange}
          payableIntro={payableIntro}
        />
        <p>他の操作</p>
      </main>
    </DisplayPreferencesProvider>,
    { cachedViewer: signedInViewerQuery() },
  );
};

const panel = () => page.getByRole('group', { name: ENTRY_TITLE });
const entryButton = () => page.getByRole('button', { name: BUTTON_NAME });
const timer = () => page.getByRole('timer', { name: '決済期限までの残り時間' });
const alert = () => page.getByRole('alert');

const panelText = (): string => (panel().element() as HTMLElement).textContent;

const lastReport = (report: ReturnType<typeof vi.fn>): unknown =>
  report.mock.calls.at(-1)?.[0];

const startClockAt = (serverTime: string): void => {
  notifyManager.setScheduler(queueMicrotask);
  vi.useFakeTimers({
    now: new Date(serverTime),
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  });
};

beforeEach(() => {
  executeGraphQL.mockReset();
  startCheckout.mockReset();
  startCheckout.mockResolvedValue({ purchaseId: ENTRY_PURCHASE_ID });
  respondOffer();
  vi.useFakeTimers({
    now: new Date(SERVER_TIME_THREE_DAYS_BEFORE),
    toFake: ['Date'],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('TournamentEntryPanelBodyの表示の有無', () => {
  test('枠が無ければ何も描かず、秒読みを持たない旨を申告する', async () => {
    const report = vi.fn();
    await renderBody(null, { onAutoUpdatingChange: report });

    await expect.element(page.getByText('他の操作')).toBeVisible();
    await expect.element(panel()).not.toBeInTheDocument();
    await expect.poll(() => lastReport(report)).toBe(false);
  });

  test('枠があれば、文言の題名を名前にした区画を描く', async () => {
    await renderBody(PAID_ENTITLED_ENTRY);

    await expect.element(panel()).toBeVisible();
    expect(panelText().startsWith(ENTRY_TITLE)).toBe(true);
  });
});

describe('受付中で受付期限より前の決済の導線', () => {
  test('項目「決済期限」と受付期限の日時、文言のボタンと参加費を示す', async () => {
    await renderBody(entryInputOf());

    await expect.element(entryButton()).toBeEnabled();
    await expect
      .element(entryButton())
      .toHaveAccessibleName(`${ENTRY_BUTTON_LABEL} 参加費$5.00`);
    await expect.element(panel().getByText('決済期限')).toBeVisible();
    const time = document.querySelector(
      `time[datetime="${ENTRY_ACCEPT_UNTIL}"]`,
    );
    expect(time?.textContent).toBe('11月24日(火) 16:00');
    expect(time?.parentElement?.textContent).toBe(
      '11月24日(火) 16:00(あと3日)',
    );
    expect(timer().query()).toBeNull();
  });

  test('押すと決済の開始を枠のローンチのIDで呼び、結果の購入の決済画面へ移る', async () => {
    const router = await renderBody(entryInputOf());

    await userEvent.click(entryButton());

    await expect
      .poll(() => router.state.location.pathname)
      .toBe(`/checkout/${ENTRY_PURCHASE_ID}`);
    expect(startCheckout).toHaveBeenCalledTimes(1);
    expect(startCheckout.mock.calls[0]?.[0]).toStrictEqual({
      variables: { launchId: ENTRY_LAUNCH_ID },
    });
  });

  test('Ultrasの案内を要する枠は、ボタンの下にUltrasの案内と料金ページへのリンクを添える', async () => {
    await renderBody(entryInputOf());

    const guide = panel().getByText(/なら参加費が免除され/u);
    await expect.element(guide).toBeVisible();
    expect(guide.element().textContent).toBe(ULTRAS_GUIDE);
    await expect
      .element(panel().getByRole('link', { name: '料金を見る' }))
      .toHaveAttribute('href', '/pricing');
  });

  test('Ultrasの案内を要しない枠は、Ultrasの案内を出さない', async () => {
    await renderBody(entryInputOf({ ultrasGuide: false }));

    await expect.element(entryButton()).toBeVisible();
    await expect
      .element(panel().getByRole('link', { name: '料金を見る' }))
      .not.toBeInTheDocument();
  });

  test('参加費が無いときは、ボタンを無効にし決済サービスの障害の案内を示す', async () => {
    await renderBody(entryInputOf({ feeAmount: null }));

    await expect.element(entryButton()).toBeDisabled();
    await expect
      .element(entryButton())
      .toHaveAccessibleName(ENTRY_BUTTON_LABEL);
    await expect
      .element(panel().getByRole('status'))
      .toHaveTextContent(`現在ご利用いただけません。${UNAVAILABLE_REASON}`);
  });

  test('決済を始められない理由があるときは、ボタンを無効にしその理由を示す', async () => {
    await renderBody(PRODUCT_UNAVAILABLE_ENTRY);

    await expect.element(entryButton()).toBeDisabled();
    await expect
      .element(panel().getByRole('status'))
      .toHaveTextContent(
        `現在ご利用いただけません。${PRODUCT_UNAVAILABLE_MESSAGE}`,
      );
    await userEvent.click(entryButton(), { force: true });
    expect(startCheckout).not.toHaveBeenCalled();
  });

  test('押した後に決済サービスの障害が返ると、ボタンを無効にし障害の案内を示す', async () => {
    startCheckout.mockRejectedValue(
      failureOf(
        'payments_unavailable',
        503,
        '現在、決済をご利用いただけません。',
      ),
    );
    await renderBody(entryInputOf());

    await userEvent.click(entryButton());

    await expect.element(entryButton()).toBeDisabled();
    await expect
      .element(panel().getByRole('status'))
      .toHaveTextContent(`現在ご利用いただけません。${UNAVAILABLE_REASON}`);
    await expect.element(alert()).not.toBeInTheDocument();
  });

  test('押した後にcheckout_closedが返ると、文言の受付の終了をボタンの近くに示す', async () => {
    startCheckout.mockRejectedValue(
      failureOf('checkout_closed', 422, '決済の受付は終了しました。'),
    );
    await renderBody(entryInputOf());

    await userEvent.click(entryButton());

    await expect.element(alert()).toHaveTextContent(ENTRY_CLOSED_MESSAGE);
    await expect
      .element(entryButton())
      .toHaveAccessibleDescription(ENTRY_CLOSED_MESSAGE);
    expect(panelText()).not.toContain('決済の受付は終了しました。');
  });

  test('押した後に種類の拒否の理由が返ると、サーバーの文言をボタンの近くに示す', async () => {
    const message = 'このプロダクトは現在Testトーナメントに参加できません。';
    startCheckout.mockRejectedValue(
      failureOf('test_entry_product_unavailable', 422, message),
    );
    await renderBody(entryInputOf());

    await userEvent.click(entryButton());

    await expect.element(alert()).toHaveTextContent(message);
    await expect.element(entryButton()).toBeEnabled();
  });
});

describe('決済の導線の案内', () => {
  const INTRO = 'Testの案内の文。';

  test('案内を渡すと、決済の導線の間だけ決済期限の前に示す', async () => {
    await renderBody(entryInputOf(), {
      payableIntro: (
        <>
          {INTRO}
          <time dateTime="2027-05-30">5月30日</time>
        </>
      ),
    });

    const intro = panel().getByText(INTRO);
    await expect.element(intro).toBeVisible();
    expect(intro.element().textContent).toBe(`${INTRO}5月30日`);
    expect(
      intro
        .element()
        .compareDocumentPosition(panel().getByText('決済期限').element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test.each([
    ['受付中の免除', EXEMPT_AWAITING_ENTRY],
    ['受付期限の後の支払い待ち', CLOSED_AWAITING_ENTRY],
    ['決済の参加資格', PAID_ENTITLED_ENTRY],
    ['組み合わせの勝ち残り', ALIVE_ENTRY],
  ])('%sの枠には、案内を示さない', async (_name, entry) => {
    await renderBody(entry, { payableIntro: INTRO });

    await expect.element(panel()).toBeVisible();
    expect(panelText()).not.toContain(INTRO);
  });
});

describe('受付期限までの残り時間の強調と秒読みの有無', () => {
  test('秒読みを添える指定では、受付期限まで48時間未満で注意色・秒読みを示し、秒読みを持つ旨を申告する', async () => {
    const report = vi.fn();
    await renderBody(
      entryInputOf({ serverTime: serverTimeBeforeAcceptUntil(HOUR_MS) }),
      { onAutoUpdatingChange: report },
    );

    await expect.element(timer()).toBeVisible();
    const deadline = document.querySelector('[data-entry-deadline-time]');
    expect(deadline === null ? '' : getComputedStyle(deadline).color).toBe(
      tokenColorOf('warning-strong'),
    );
    await expect.poll(() => lastReport(report)).toBe(true);
  });

  test('秒読みを添えない指定では、受付期限まで48時間未満でも秒読みと注意色を出さず、秒読みを持たない旨を申告する', async () => {
    const report = vi.fn();
    await renderBody(
      entryInputOf({ serverTime: serverTimeBeforeAcceptUntil(HOUR_MS) }),
      { countdown: false, onAutoUpdatingChange: report },
    );

    await expect.element(entryButton()).toBeVisible();
    expect(timer().query()).toBeNull();
    const deadline = document.querySelector('[data-entry-deadline-time]');
    expect(deadline === null ? '' : getComputedStyle(deadline).color).not.toBe(
      tokenColorOf('warning-strong'),
    );
    await expect.poll(() => lastReport(report)).toBe(false);
    expect(report).not.toHaveBeenCalledWith(true);
  });

  test('秒読みを添える指定では、受付期限の48時間前の境界で取り直しを求める', async () => {
    const reached = vi.fn();
    startClockAt(SERVER_TIME_48_HOURS_BEFORE);
    await renderBody(
      entryInputOf({ serverTime: SERVER_TIME_48_HOURS_BEFORE }),
      { onBoundaryReached: reached },
    );

    await expect.element(entryButton()).toBeVisible();
    expect(reached).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SECOND_MS);
    expect(reached).toHaveBeenCalledTimes(1);
  });

  test('秒読みを添えない指定では、受付期限の48時間前に取り直さず、受付期限の境界で取り直しを求める', async () => {
    const reached = vi.fn();
    startClockAt(SERVER_TIME_48_HOURS_BEFORE);
    await renderBody(
      entryInputOf({ serverTime: SERVER_TIME_48_HOURS_BEFORE }),
      { countdown: false, onBoundaryReached: reached },
    );

    await expect.element(entryButton()).toBeVisible();
    await vi.advanceTimersByTimeAsync(2 * SECOND_MS);
    expect(reached).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(48 * HOUR_MS);
    expect(reached).toHaveBeenCalledTimes(1);
  });
});

describe('受付中でない枠と免除の状態', () => {
  test.each([
    ['受付中でUltrasの特典で免除される', EXEMPT_AWAITING_ENTRY],
    ['Ultrasの特典で参加資格を得た', ULTRAS_ENTITLED_ENTRY],
  ])(
    '%s枠は、ボタンの代わりに「参加費免除」と文言の免除の文を示す',
    async (_name, entry) => {
      await renderBody(entry);

      await expect.element(panel().getByText('参加費免除')).toBeVisible();
      await expect
        .element(panel().getByText(ENTRY_EXEMPT_MESSAGE))
        .toBeVisible();
      await expect.element(entryButton()).not.toBeInTheDocument();
      expect(panelText()).not.toContain('決済期限');
    },
  );

  test('受付期限の後の支払い待ちは、文言の受付の終了を示す', async () => {
    await renderBody(CLOSED_AWAITING_ENTRY);

    await expect.element(panel().getByText(ENTRY_CLOSED_MESSAGE)).toBeVisible();
    await expect.element(entryButton()).not.toBeInTheDocument();
  });

  test('決済で参加資格を得た枠は、文言の前後に組み合わせ決定の日時を挟んで示す', async () => {
    await renderBody(PAID_ENTITLED_ENTRY);

    await expect.element(panel()).toBeVisible();
    expect(panelText()).toBe(
      `${ENTRY_TITLE}Testの参加資格を得ました。組み合わせの決定は11月24日(火) 16:45です。`,
    );
    expect(
      document.querySelector(`time[datetime="${ENTRY_DRAW_AT}"]`),
    ).not.toBeNull();
  });

  test.each([
    ['勝ち残り', ALIVE_ENTRY, ENTRY_DRAWN_MESSAGE],
    ['敗退', ELIMINATED_ENTRY, 'Testの準決勝で敗退。'],
    ['優勝', CHAMPION_ENTRY, ENTRY_CHAMPION_MESSAGE],
  ])(
    '組み合わせに入った枠(%s)は、文言の状態とブラケットのページへの導線を示す',
    async (_name, entry, message) => {
      await renderBody(entry);

      await expect.element(panel().getByText(message)).toBeVisible();
      await expect
        .element(panel().getByRole('link', { name: 'ブラケットを見る' }))
        .toHaveAttribute('href', ENTRY_BRACKET_PATH);
    },
  );

  test('ブラケットの経路が無い組み合わせの枠は、導線を出さない', async () => {
    await renderBody({ ...ALIVE_ENTRY, bracketPath: null });

    await expect.element(panel().getByText(ENTRY_DRAWN_MESSAGE)).toBeVisible();
    await expect
      .element(panel().getByRole('link', { name: 'ブラケットを見る' }))
      .not.toBeInTheDocument();
  });

  test.each([
    ['期限切れ', expiredEntryOf(false), 'Testの期限切れ。'],
    [
      '組み合わせ決定の後の確定による期限切れ',
      expiredEntryOf(true),
      'Testの組み合わせ決定に間に合いませんでした。',
    ],
    [
      '返金の対象の資格の喪失',
      forfeitedEntryOf(true),
      `${ENTRY_FORFEITED_MESSAGE}${ENTRY_FORFEITED_REFUND_SUFFIX}`,
    ],
    [
      '返金の対象でない資格の喪失',
      forfeitedEntryOf(false),
      ENTRY_FORFEITED_MESSAGE,
    ],
    [
      '返金の対象の非公開・停止による除外',
      excludedEntryOf(true),
      `Testのプロダクトが公開されていないため除外されました。${ENTRY_EXCLUDED_REFUND_SUFFIX}`,
    ],
    [
      '返金の対象の上限による除外',
      excludedEntryOf(true, 'over_capacity'),
      `Testの参加数の上限により除外されました。${ENTRY_EXCLUDED_REFUND_SUFFIX}`,
    ],
    [
      '返金の対象でない上限による除外',
      excludedEntryOf(false, 'over_capacity'),
      'Testの参加数の上限により除外されました。',
    ],
  ])(
    '%sの枠は、文言の状態を示しボタンを出さない',
    async (_name, entry, message) => {
      await renderBody(entry);

      await expect.element(panel()).toBeVisible();
      expect(panelText()).toBe(`${ENTRY_TITLE}${message}`);
      await expect.element(entryButton()).not.toBeInTheDocument();
    },
  );
});

describe('TournamentEntryPanelBodyのアクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '秒読み・Ultrasの案内・参加費が無い案内を出した状態で自動検査の違反が無い(%s)',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderBody(
        entryInputOf({
          feeAmount: null,
          serverTime: serverTimeBeforeAcceptUntil(HOUR_MS),
        }),
      );

      await expect.element(timer()).toBeVisible();
      await expect
        .element(panel().getByRole('link', { name: '料金を見る' }))
        .toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '押した後の拒否の文言を出した状態で自動検査の違反が無い(%s)',
    async (scheme) => {
      applyColorScheme(scheme);
      startCheckout.mockRejectedValue(
        failureOf('checkout_closed', 422, '決済の受付は終了しました。'),
      );
      await renderBody(entryInputOf());
      await userEvent.click(entryButton());
      await expect.element(alert()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each([EXEMPT_AWAITING_ENTRY, ELIMINATED_ENTRY, excludedEntryOf(true)])(
    '状態の表示で自動検査の違反が無い(%#)',
    async (entry) => {
      await renderBody(entry);

      await expect.element(panel()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
