import { notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  tokenColorOf,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientMyWeekEntryDocument,
  ClientStartWeekTournamentCheckoutDocument,
  ClientUltrasOfferDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import {
  ALIVE_ENTRY,
  CHAMPION_ENTRY,
  CLOSED_AWAITING_ENTRY,
  closedEntryOf,
  ELIMINATED_ENTRY,
  EXEMPT_AWAITING_ENTRY,
  PAID_ENTITLED_ENTRY,
  PRODUCT_UNAVAILABLE_ENTRY,
  PRODUCT_UNAVAILABLE_MESSAGE,
  SERVER_TIME_48_HOURS_BEFORE,
  SERVER_TIME_THREE_DAYS_BEFORE,
  serverTimeBeforeAcceptUntil,
  ULTRAS_ENTITLED_ENTRY,
  WEEK_ENTRY_ACCEPT_UNTIL,
  WEEK_ENTRY_BRACKET_PATH,
  WEEK_ENTRY_DRAW_AT,
  WEEK_ENTRY_LAUNCH_ID,
  WEEK_ENTRY_PRODUCT_HANDLE,
  WEEK_ENTRY_PURCHASE_ID,
  weekEntryOf,
} from './week-entry-fixtures.ts';
import type { WeekEntryPanelView } from './week-entry-model.ts';
import { WeekEntryPanel } from './week-entry-panel.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKYO_JA = { timeZone: 'Asia/Tokyo', locale: 'ja-JP' } as const;

const SECOND_MS = 1000;
const HOUR_MS = 3_600_000;

const VERIFIED_VIEWER = signedInViewerQuery();

const BUTTON_NAME = /^Weekトーナメントに参加/u;

const UNAVAILABLE_REASON =
  '決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';

const CLOSED_MESSAGE = 'Weekトーナメントの参加受付は終了しました。';

const EXEMPT_MESSAGE =
  'Ultrasの特典によりWeekトーナメントの参加資格を得ています。参加のための操作は不要です。';

const ULTRAS_GUIDE =
  'Ultrasなら参加費が免除され、敗北後は2日で再ローンチできます。料金を見る';

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、テストの後に既定の通知へ戻す
const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

type Outcome<T> = T | GraphQLClientError;

interface Responses {
  readonly entries: readonly Outcome<WeekEntryPanelView | null>[];
  readonly promotionEnabled?: boolean;
  readonly checkout?: Outcome<string>;
}

const resultOf = <T,>(outcome: Outcome<T>, wrap: (value: T) => unknown) =>
  outcome instanceof GraphQLClientError
    ? { ok: false, error: outcome }
    : { ok: true, data: wrap(outcome) };

// 参加費の導線の取得は呼ぶたびに先頭の結果を返し、最後の結果は返し続ける
const respond = ({
  entries,
  promotionEnabled = true,
  checkout = WEEK_ENTRY_PURCHASE_ID,
}: Responses): void => {
  const queue = [...entries];
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientMyWeekEntryDocument) {
      const next = (queue.length > 1 ? queue.shift() : queue[0]) ?? null;
      return Promise.resolve(
        resultOf(next, (myWeekEntry) => ({ myWeekEntry })),
      );
    }
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
    if (document === ClientStartWeekTournamentCheckoutDocument) {
      return Promise.resolve(
        resultOf(checkout, (purchaseId) => ({
          startWeekTournamentCheckout: { purchaseId },
        })),
      );
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

const failureOf = (code: string, status: number, message: string) =>
  new GraphQLClientError({ code, message, status });

interface RenderOptions {
  readonly viewerQuery?: ClientViewerQuery;
  readonly autoRefresh?: boolean;
  readonly onAutoUpdatingChange?: (active: boolean) => void;
}

const renderPanel = async ({
  viewerQuery = VERIFIED_VIEWER,
  autoRefresh = true,
  onAutoUpdatingChange,
}: RenderOptions = {}) => {
  await emulateBrowserDisplay(TOKYO_JA);
  return renderInRouter(
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <main>
        <RecoverableSlot contactAvailable={false}>
          <WeekEntryPanel
            productHandle={WEEK_ENTRY_PRODUCT_HANDLE}
            autoRefresh={autoRefresh}
            onAutoUpdatingChange={onAutoUpdatingChange}
          />
        </RecoverableSlot>
        <p>他の操作</p>
      </main>
    </DisplayPreferencesProvider>,
    { cachedViewer: viewerQuery },
  );
};

const panel = () =>
  page.getByRole('group', { name: 'Product of the Weekトーナメント' });
const entryButton = () => page.getByRole('button', { name: BUTTON_NAME });
const timer = () => page.getByRole('timer', { name: '決済期限までの残り時間' });
const alert = () => page.getByRole('alert');

const callsOf = (document: unknown) =>
  executeGraphQL.mock.calls.filter(([called]) => called === document);

const panelText = (): string => (panel().element() as HTMLElement).textContent;

const startClockAt = (serverTime: string): void => {
  notifyManager.setScheduler(queueMicrotask);
  vi.useFakeTimers({
    now: new Date(serverTime),
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  });
};

beforeEach(() => {
  executeGraphQL.mockReset();
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

describe('WeekEntryPanelの表示の有無', () => {
  test('投稿者本人のプロダクトの参加の枠を取得し、枠が無ければ何も描かない', async () => {
    respond({ entries: [null] });
    await renderPanel();

    await expect.element(page.getByText('他の操作')).toBeVisible();
    await expect.poll(() => callsOf(ClientMyWeekEntryDocument).length).toBe(1);
    expect(callsOf(ClientMyWeekEntryDocument)[0]?.[1]).toStrictEqual({
      productHandle: WEEK_ENTRY_PRODUCT_HANDLE,
    });
    await expect.element(panel()).not.toBeInTheDocument();
  });

  test('未ログインの閲覧者には取得せず何も描かない', async () => {
    respond({ entries: [weekEntryOf()] });
    await renderPanel({ viewerQuery: GUEST_VIEWER_QUERY });

    await expect.element(page.getByText('他の操作')).toBeVisible();
    await expect.element(panel()).not.toBeInTheDocument();
    expect(callsOf(ClientMyWeekEntryDocument)).toHaveLength(0);
  });
});

describe('受付中で受付期限より前の決済の導線', () => {
  test('項目「決済期限」と受付期限の日時、ボタン「Weekトーナメントに参加」と参加費を示す', async () => {
    respond({ entries: [weekEntryOf()] });
    await renderPanel();

    await expect.element(entryButton()).toBeEnabled();
    await expect
      .element(entryButton())
      .toHaveAccessibleName('Weekトーナメントに参加 参加費$5.00');
    await expect.element(panel().getByText('決済期限')).toBeVisible();
    const time = document.querySelector(
      `time[datetime="${WEEK_ENTRY_ACCEPT_UNTIL}"]`,
    );
    expect(time?.textContent).toBe('11月24日(火) 16:00');
    expect(time?.parentElement?.textContent).toBe(
      '11月24日(火) 16:00(あと3日)',
    );
    expect(timer().query()).toBeNull();
  });

  test('押すと参加費の購入を作り、その購入の決済画面へ移る', async () => {
    respond({ entries: [weekEntryOf()] });
    const router = await renderPanel();

    await userEvent.click(entryButton());

    await expect
      .poll(() => router.state.location.pathname)
      .toBe(`/checkout/${WEEK_ENTRY_PURCHASE_ID}`);
    expect(callsOf(ClientStartWeekTournamentCheckoutDocument)).toHaveLength(1);
    expect(
      callsOf(ClientStartWeekTournamentCheckoutDocument)[0]?.[1],
    ).toStrictEqual({ launchId: WEEK_ENTRY_LAUNCH_ID });
  });

  test('Ultrasの導線の表示が有効で未加入なら、ボタンの下にUltrasの案内と料金ページへのリンクを添える', async () => {
    respond({ entries: [weekEntryOf()] });
    await renderPanel();

    const guide = panel().getByText(/なら参加費が免除され/u);
    await expect.element(guide).toBeVisible();
    expect(guide.element().textContent).toBe(ULTRAS_GUIDE);
    await expect
      .element(panel().getByRole('link', { name: '料金を見る' }))
      .toHaveAttribute('href', '/pricing');
    expect(
      entryButton().element().compareDocumentPosition(guide.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test.each([
    ['Ultrasの導線の表示が無効', weekEntryOf(), false, 1],
    [
      'サーバーがUltrasの案内を要しないとした',
      weekEntryOf({ ultrasGuide: false }),
      true,
      0,
    ],
  ] as const)(
    '%sときは、Ultrasの案内を出さない',
    async (_name, entry, promotionEnabled, offerCalls) => {
      respond({ entries: [entry], promotionEnabled });
      await renderPanel();

      await expect.element(entryButton()).toBeVisible();
      await expect
        .poll(() => callsOf(ClientUltrasOfferDocument).length)
        .toBe(offerCalls);
      await expect
        .element(panel().getByRole('link', { name: '料金を見る' }))
        .not.toBeInTheDocument();
    },
  );

  test('参加費を取得できないときは、ボタンを無効にし「現在ご利用いただけません」と閲覧やその他の操作は利用できる旨を示す', async () => {
    respond({ entries: [weekEntryOf({ fee: null })] });
    await renderPanel();

    await expect.element(entryButton()).toBeDisabled();
    await expect
      .element(entryButton())
      .toHaveAccessibleName('Weekトーナメントに参加');
    // 題名は段落の中のブロックの要素のため、説明では理由の文との間に空白が入る
    await expect
      .element(entryButton())
      .toHaveAccessibleDescription(
        `現在ご利用いただけません。 ${UNAVAILABLE_REASON}`,
      );
    await expect
      .element(panel().getByRole('status'))
      .toHaveTextContent(`現在ご利用いただけません。${UNAVAILABLE_REASON}`);
    expect(callsOf(ClientStartWeekTournamentCheckoutDocument)).toHaveLength(0);
  });

  test('プロダクトを表示できない間は、参加費と受付期限を出したままボタンを無効にし、決済の開始と同じ理由の文言をボタンの近くに示す', async () => {
    respond({ entries: [PRODUCT_UNAVAILABLE_ENTRY] });
    await renderPanel();

    await expect.element(entryButton()).toBeDisabled();
    await expect
      .element(entryButton())
      .toHaveAccessibleName('Weekトーナメントに参加 参加費$5.00');
    await expect
      .element(entryButton())
      .toHaveAccessibleDescription(
        `現在ご利用いただけません。 ${PRODUCT_UNAVAILABLE_MESSAGE}`,
      );
    await expect
      .element(panel().getByRole('status'))
      .toHaveTextContent(
        `現在ご利用いただけません。${PRODUCT_UNAVAILABLE_MESSAGE}`,
      );
    await expect.element(panel().getByText('決済期限')).toBeVisible();
    expect(
      document.querySelector(`time[datetime="${WEEK_ENTRY_ACCEPT_UNTIL}"]`),
    ).not.toBeNull();
    await userEvent.click(entryButton(), { force: true });
    expect(callsOf(ClientStartWeekTournamentCheckoutDocument)).toHaveLength(0);
  });

  test('参加費を取得できずプロダクトも表示できないときは、プロダクトの理由だけを示す', async () => {
    respond({ entries: [{ ...PRODUCT_UNAVAILABLE_ENTRY, fee: null }] });
    await renderPanel();

    await expect.element(entryButton()).toBeDisabled();
    await expect
      .element(panel().getByRole('status'))
      .toHaveTextContent(
        `現在ご利用いただけません。${PRODUCT_UNAVAILABLE_MESSAGE}`,
      );
    expect(panel().getByRole('status').elements()).toHaveLength(1);
  });

  test('押した後に決済サービスの障害が返ると、ボタンを無効にし障害の案内を示す', async () => {
    respond({
      entries: [weekEntryOf()],
      checkout: failureOf(
        'payments_unavailable',
        503,
        `現在、決済をご利用いただけません。${UNAVAILABLE_REASON}`,
      ),
    });
    await renderPanel();

    await userEvent.click(entryButton());

    await expect.element(entryButton()).toBeDisabled();
    await expect
      .element(panel().getByRole('status'))
      .toHaveTextContent(`現在ご利用いただけません。${UNAVAILABLE_REASON}`);
    await expect.element(alert()).not.toBeInTheDocument();
  });

  test('押した後に受付期限の後の開始(checkout_closed)が返ると、決済の文言ではなく参加受付の終了の文言をボタンの近くに示す', async () => {
    respond({
      entries: [weekEntryOf()],
      checkout: failureOf('checkout_closed', 422, '決済の受付は終了しました。'),
    });
    await renderPanel();

    await userEvent.click(entryButton());

    await expect.element(alert()).toHaveTextContent(CLOSED_MESSAGE);
    await expect
      .element(entryButton())
      .toHaveAccessibleDescription(CLOSED_MESSAGE);
    expect(panelText()).not.toContain('決済の受付は終了しました。');
  });

  test.each([
    ['week_entry_not_found', 'このWeekトーナメントの参加枠は見つかりません。'],
    [
      'week_entry_already_entitled',
      'このプロダクトはWeekトーナメントの参加資格を得ています。',
    ],
    ['week_entry_closed', CLOSED_MESSAGE],
    [
      'week_entry_product_unavailable',
      'このプロダクトは現在Weekトーナメントに参加できません。',
    ],
    ['week_entry_exempt', 'Ultrasの特典により参加費は免除されます。'],
  ])(
    '押した後に%sが返ると、その理由の文言をボタンの近くに示す',
    async (code, message) => {
      respond({
        entries: [weekEntryOf()],
        checkout: failureOf(code, 422, message),
      });
      await renderPanel();

      await userEvent.click(entryButton());

      await expect.element(alert()).toHaveTextContent(message);
      await expect.element(entryButton()).toBeEnabled();
    },
  );
});

describe('受付期限までの残り時間の強調', () => {
  test('受付期限まで48時間ちょうどは強調せず、48時間未満になった境界で取り直して注意色と秒読みを出す', async () => {
    startClockAt(SERVER_TIME_48_HOURS_BEFORE);
    respond({
      entries: [
        weekEntryOf({ serverTime: SERVER_TIME_48_HOURS_BEFORE }),
        weekEntryOf({
          serverTime: serverTimeBeforeAcceptUntil(48 * HOUR_MS - SECOND_MS),
        }),
      ],
    });
    await renderPanel();

    await expect.element(entryButton()).toBeVisible();
    expect(timer().query()).toBeNull();
    expect(callsOf(ClientMyWeekEntryDocument)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(SECOND_MS);

    await expect.poll(() => callsOf(ClientMyWeekEntryDocument).length).toBe(2);
    await expect.element(timer()).toBeVisible();
    expect(
      (timer().element() as HTMLElement).querySelector(
        '[data-countdown-digits]',
      )?.textContent,
    ).toBe('47:59:59');
    const deadline = document.querySelector('[data-entry-deadline-time]');
    expect(deadline === null ? '' : getComputedStyle(deadline).color).toBe(
      tokenColorOf('warning-strong'),
    );
  });

  test('受付期限の境界で取り直し、受付の終了を示してボタンを出さない', async () => {
    const shortly = serverTimeBeforeAcceptUntil(10 * SECOND_MS);
    startClockAt(shortly);
    respond({
      entries: [
        weekEntryOf({ serverTime: shortly }),
        weekEntryOf({
          fee: null,
          ultrasGuide: false,
          serverTime: serverTimeBeforeAcceptUntil(-SECOND_MS),
        }),
      ],
    });
    await renderPanel();

    await expect.element(timer()).toBeVisible();
    await vi.advanceTimersByTimeAsync(11 * SECOND_MS);

    await expect.element(panel().getByText(CLOSED_MESSAGE)).toBeVisible();
    await expect.element(entryButton()).not.toBeInTheDocument();
  });

  test('自動更新がオフの間は、48時間未満でも秒読みを出さない', async () => {
    respond({
      entries: [
        weekEntryOf({ serverTime: serverTimeBeforeAcceptUntil(HOUR_MS) }),
      ],
    });
    await renderPanel({ autoRefresh: false });

    await expect.element(entryButton()).toBeVisible();
    expect(timer().query()).toBeNull();
  });
});

describe('毎秒の更新の申告', () => {
  const lastReport = (report: ReturnType<typeof vi.fn>): unknown =>
    report.mock.calls.at(-1)?.[0];

  test.each([
    ['自動更新がオン', true],
    ['自動更新がオフ', false],
  ])(
    '受付期限まで48時間未満の決済の導線は、%sでも秒読みを持つ間として真を申告する',
    async (_name, autoRefresh) => {
      const report = vi.fn();
      respond({
        entries: [
          weekEntryOf({ serverTime: serverTimeBeforeAcceptUntil(HOUR_MS) }),
        ],
      });
      await renderPanel({ autoRefresh, onAutoUpdatingChange: report });

      await expect.element(entryButton()).toBeVisible();
      await expect.poll(() => lastReport(report)).toBe(true);
      expect(report).not.toHaveBeenCalledWith(false);
    },
  );

  test.each([
    [
      '受付期限まで48時間ちょうどの決済の導線',
      weekEntryOf({ serverTime: SERVER_TIME_48_HOURS_BEFORE }),
    ],
    ['受付期限の後の支払い待ち', CLOSED_AWAITING_ENTRY],
    ['免除の枠', EXEMPT_AWAITING_ENTRY],
    ['組み合わせに入った枠', ALIVE_ENTRY],
  ])('%sは偽を申告する', async (_name, entry) => {
    const report = vi.fn();
    respond({ entries: [entry] });
    await renderPanel({ onAutoUpdatingChange: report });

    await expect.element(panel()).toBeVisible();
    await expect.poll(() => lastReport(report)).toBe(false);
    expect(report).not.toHaveBeenCalledWith(true);
  });

  test('枠が無ければ偽を申告する', async () => {
    const report = vi.fn();
    respond({ entries: [null] });
    await renderPanel({ onAutoUpdatingChange: report });

    await expect.poll(() => callsOf(ClientMyWeekEntryDocument).length).toBe(1);
    await expect.poll(() => lastReport(report)).toBe(false);
    expect(report).not.toHaveBeenCalledWith(true);
  });

  test('48時間未満になった境界の取り直しで、偽から真に申告し直す', async () => {
    const report = vi.fn();
    startClockAt(SERVER_TIME_48_HOURS_BEFORE);
    respond({
      entries: [
        weekEntryOf({ serverTime: SERVER_TIME_48_HOURS_BEFORE }),
        weekEntryOf({
          serverTime: serverTimeBeforeAcceptUntil(48 * HOUR_MS - SECOND_MS),
        }),
      ],
    });
    await renderPanel({ onAutoUpdatingChange: report });

    await expect.poll(() => lastReport(report)).toBe(false);
    await vi.advanceTimersByTimeAsync(SECOND_MS);
    await expect.poll(() => lastReport(report)).toBe(true);
  });

  test('受付期限の境界の取り直しで、真から偽に申告し直す', async () => {
    const report = vi.fn();
    const shortly = serverTimeBeforeAcceptUntil(10 * SECOND_MS);
    startClockAt(shortly);
    respond({
      entries: [
        weekEntryOf({ serverTime: shortly }),
        weekEntryOf({
          fee: null,
          ultrasGuide: false,
          serverTime: serverTimeBeforeAcceptUntil(-SECOND_MS),
        }),
      ],
    });
    await renderPanel({ onAutoUpdatingChange: report });

    await expect.poll(() => lastReport(report)).toBe(true);
    await vi.advanceTimersByTimeAsync(11 * SECOND_MS);
    await expect.element(panel().getByText(CLOSED_MESSAGE)).toBeVisible();
    await expect.poll(() => lastReport(report)).toBe(false);
  });
});

describe('受付中でない枠と免除の状態', () => {
  test.each([
    ['受付中でUltrasの特典で免除される', EXEMPT_AWAITING_ENTRY],
    ['Ultrasの特典で参加資格を得た', ULTRAS_ENTITLED_ENTRY],
  ])(
    '%s枠は、ボタンの代わりに「参加費免除」の状態を示す',
    async (_name, entry) => {
      respond({ entries: [entry] });
      await renderPanel();

      await expect.element(panel().getByText('参加費免除')).toBeVisible();
      await expect.element(panel().getByText(EXEMPT_MESSAGE)).toBeVisible();
      await expect.element(entryButton()).not.toBeInTheDocument();
      expect(panelText()).not.toContain('決済期限');
    },
  );

  test('受付期限の後で組み合わせ決定の前の支払い待ちは、受付の終了を示す', async () => {
    respond({ entries: [CLOSED_AWAITING_ENTRY] });
    await renderPanel();

    await expect.element(panel().getByText(CLOSED_MESSAGE)).toBeVisible();
    await expect.element(entryButton()).not.toBeInTheDocument();
  });

  test('決済で参加資格を得た枠は、参加資格を得た旨と組み合わせ決定の日時を示す', async () => {
    respond({ entries: [PAID_ENTITLED_ENTRY] });
    await renderPanel();

    await expect
      .element(panel().getByText(/^参加資格を得ました。/u))
      .toBeVisible();
    expect(panelText()).toContain(
      '参加資格を得ました。組み合わせは11月24日(火) 16:45に決定します。',
    );
    expect(
      document.querySelector(`time[datetime="${WEEK_ENTRY_DRAW_AT}"]`),
    ).not.toBeNull();
  });

  test.each([
    ['勝ち残り', ALIVE_ENTRY, '組み合わせに参加しています。'],
    ['敗退', ELIMINATED_ENTRY, '準決勝で敗退しました。'],
    ['優勝', CHAMPION_ENTRY, 'Product of the Weekを受賞しました。'],
  ])(
    '組み合わせに入った枠(%s)は、その状態とブラケットのページへの導線を示す',
    async (_name, entry, message) => {
      respond({ entries: [entry] });
      await renderPanel();

      await expect.element(panel().getByText(message)).toBeVisible();
      await expect
        .element(panel().getByRole('link', { name: 'ブラケットを見る' }))
        .toHaveAttribute('href', WEEK_ENTRY_BRACKET_PATH);
    },
  );

  test.each([
    [
      '期限切れ',
      closedEntryOf('EXPIRED', 'DEADLINE'),
      '決済期限までに参加費の決済が無かったため参加できませんでした。',
    ],
    [
      '組み合わせ決定の後の予選の勝利による期限切れ',
      closedEntryOf('EXPIRED', 'LATE_ENTRY'),
      '予選の勝利が組み合わせ決定に間に合わなかったため参加できませんでした。',
    ],
    [
      '資格の喪失',
      closedEntryOf('FORFEITED', 'DELETED'),
      '組み合わせ決定前にプロダクトが削除されたため参加資格を失いました。支払った参加費は自動で全額返金されます。',
    ],
    [
      'Ultrasの特典の枠の資格の喪失',
      closedEntryOf('FORFEITED', 'DELETED', true),
      '組み合わせ決定前にプロダクトが削除されたため参加資格を失いました。',
    ],
    [
      '除外',
      closedEntryOf('EXCLUDED', 'HIDDEN_OR_SUSPENDED'),
      '組み合わせ決定の時点でプロダクトが公開されていなかったため参加できませんでした。参加費は返金されます。',
    ],
    [
      'Ultrasの特典の枠の除外',
      closedEntryOf('EXCLUDED', 'HIDDEN_OR_SUSPENDED', true),
      '組み合わせ決定の時点でプロダクトが公開されていなかったため参加できませんでした。',
    ],
  ])(
    '%sの枠は、その旨を示しボタンを出さない',
    async (_name, entry, message) => {
      respond({ entries: [entry] });
      await renderPanel();

      await expect.element(panel()).toBeVisible();
      expect(panelText()).toBe(`Product of the Weekトーナメント${message}`);
      await expect.element(entryButton()).not.toBeInTheDocument();
    },
  );
});

describe('WeekEntryPanelのアクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '秒読み・Ultrasの案内・取得できない参加費の案内を出した状態で自動検査の違反が無い(%s)',
    async (scheme) => {
      applyColorScheme(scheme);
      respond({
        entries: [
          weekEntryOf({
            fee: null,
            serverTime: serverTimeBeforeAcceptUntil(HOUR_MS),
          }),
        ],
      });
      await renderPanel();

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
      respond({
        entries: [weekEntryOf()],
        checkout: failureOf(
          'checkout_closed',
          422,
          '決済の受付は終了しました。',
        ),
      });
      await renderPanel();
      await userEvent.click(entryButton());
      await expect.element(alert()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each([EXEMPT_AWAITING_ENTRY, ELIMINATED_ENTRY])(
    '状態の表示で自動検査の違反が無い(%#)',
    async (entry) => {
      respond({ entries: [entry] });
      await renderPanel();

      await expect.element(panel()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
