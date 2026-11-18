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
  ClientMyYearEntryDocument,
  ClientStartYearTournamentCheckoutDocument,
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
  serverTimeBeforeAcceptUntil,
  SERVER_TIME_THREE_DAYS_BEFORE,
  ULTRAS_ENTITLED_ENTRY,
  YEAR_ENTRY_ACCEPT_UNTIL,
  YEAR_ENTRY_BRACKET_PATH,
  YEAR_ENTRY_DRAW_AT,
  YEAR_ENTRY_FINAL_DATE,
  YEAR_ENTRY_LAUNCH_ID,
  YEAR_ENTRY_PRODUCT_HANDLE,
  YEAR_ENTRY_PURCHASE_ID,
  yearEntryOf,
} from './year-entry-fixtures.ts';
import { YearEntryPanel } from './year-entry-panel.tsx';
import type { YearEntryPanelView } from './year-entry-view.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKYO_JA = { timeZone: 'Asia/Tokyo', locale: 'ja-JP' } as const;

const SECOND_MS = 1000;
const HOUR_MS = 3_600_000;

const TITLE = 'Product of the Yearトーナメント';

const BUTTON_NAME = /^Yearトーナメントに参加/u;

const INTRO =
  '2026年第47週(11/16〜11/22)のProduct of the Week受賞により、2027年のYearトーナメントに参加できます。決勝は2027年5月30日(日)です。';

const UNAVAILABLE_REASON =
  '決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';

const CLOSED_MESSAGE = 'Yearトーナメントの参加受付は終了しました。';

const EXEMPT_MESSAGE =
  'Ultrasの特典によりYearトーナメントの参加資格を得ています。参加のための操作は不要です。';

const REFUND_SUFFIX = '参加費は自動で全額返金されます。';

const SLOT_FAILURE_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。';

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、テストの後に既定の通知へ戻す
const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

type Outcome<T> = T | GraphQLClientError;

interface Responses {
  readonly entries: readonly Outcome<YearEntryPanelView | null>[];
  readonly checkout?: Outcome<string>;
}

const resultOf = <T,>(outcome: Outcome<T>, wrap: (value: T) => unknown) =>
  outcome instanceof GraphQLClientError
    ? { ok: false, error: outcome }
    : { ok: true, data: wrap(outcome) };

// 参加費の導線の取得は呼ぶたびに先頭の結果を返し、最後の結果は返し続ける
const respond = ({
  entries,
  checkout = YEAR_ENTRY_PURCHASE_ID,
}: Responses): void => {
  const queue = [...entries];
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientMyYearEntryDocument) {
      const next = (queue.length > 1 ? queue.shift() : queue[0]) ?? null;
      return Promise.resolve(
        resultOf(next, (myYearEntry) => ({ myYearEntry })),
      );
    }
    if (document === ClientStartYearTournamentCheckoutDocument) {
      return Promise.resolve(
        resultOf(checkout, (purchaseId) => ({
          startYearTournamentCheckout: { purchaseId },
        })),
      );
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

const failureOf = (code: string, status: number, message: string) =>
  new GraphQLClientError({ code, message, status });

const renderPanel = async (
  viewerQuery: ClientViewerQuery = signedInViewerQuery(),
) => {
  await emulateBrowserDisplay(TOKYO_JA);
  return renderInRouter(
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <main>
        <RecoverableSlot contactAvailable={false}>
          <YearEntryPanel productHandle={YEAR_ENTRY_PRODUCT_HANDLE} />
        </RecoverableSlot>
        <p>他の操作</p>
      </main>
    </DisplayPreferencesProvider>,
    { cachedViewer: viewerQuery },
  );
};

const panel = () => page.getByRole('group', { name: TITLE });
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

describe('YearEntryPanelの表示の有無', () => {
  test('投稿者本人のプロダクトの参加の枠を取得し、枠が無ければ何も描かない', async () => {
    respond({ entries: [null] });
    await renderPanel();

    await expect.element(page.getByText('他の操作')).toBeVisible();
    await expect.poll(() => callsOf(ClientMyYearEntryDocument).length).toBe(1);
    expect(callsOf(ClientMyYearEntryDocument)[0]?.[1]).toStrictEqual({
      productHandle: YEAR_ENTRY_PRODUCT_HANDLE,
    });
    await expect.element(panel()).not.toBeInTheDocument();
  });

  test('未ログインの閲覧者には取得せず何も描かない', async () => {
    respond({ entries: [yearEntryOf()] });
    await renderPanel(GUEST_VIEWER_QUERY);

    await expect.element(page.getByText('他の操作')).toBeVisible();
    await expect.element(panel()).not.toBeInTheDocument();
    expect(callsOf(ClientMyYearEntryDocument)).toHaveLength(0);
  });

  test('区画の取得に失敗すると、区画の位置だけに失敗の文言と再試行を示し、再試行で導線を描く', async () => {
    respond({
      entries: [
        failureOf('internal_error', 500, SLOT_FAILURE_MESSAGE),
        yearEntryOf(),
      ],
    });
    await renderPanel();

    await expect.element(page.getByText(SLOT_FAILURE_MESSAGE)).toBeVisible();
    await expect.element(page.getByText('他の操作')).toBeVisible();
    await expect.element(panel()).not.toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(entryButton()).toBeVisible();
    expect(callsOf(ClientMyYearEntryDocument)).toHaveLength(2);
  });
});

describe('受付中で受付期限より前の決済の導線', () => {
  test('Week優勝の週・対象年・決勝日の案内、項目「決済期限」と受付期限23:00の日時と相対表現、ボタンと参加費を示す', async () => {
    respond({ entries: [yearEntryOf()] });
    await renderPanel();

    await expect.element(entryButton()).toBeEnabled();
    await expect
      .element(entryButton())
      .toHaveAccessibleName('Yearトーナメントに参加 参加費$20.00');
    await expect.element(panel().getByText(INTRO)).toBeVisible();
    expect(
      document.querySelector(`time[datetime="${YEAR_ENTRY_FINAL_DATE}"]`)
        ?.textContent,
    ).toBe('2027年5月30日(日)');
    await expect.element(panel().getByText('決済期限')).toBeVisible();
    const time = document.querySelector(
      `time[datetime="${YEAR_ENTRY_ACCEPT_UNTIL}"]`,
    );
    expect(time?.textContent).toBe('5月25日(火) 16:00');
    expect(time?.parentElement?.textContent).toBe('5月25日(火) 16:00(あと3日)');
    expect(timer().query()).toBeNull();
  });

  test('受付期限まで48時間未満でも、秒読みと注意色を添えない', async () => {
    respond({
      entries: [
        yearEntryOf({ serverTime: serverTimeBeforeAcceptUntil(HOUR_MS) }),
      ],
    });
    await renderPanel();

    await expect.element(entryButton()).toBeVisible();
    expect(timer().query()).toBeNull();
    const deadline = document.querySelector('[data-entry-deadline-time]');
    expect(deadline === null ? '' : getComputedStyle(deadline).color).not.toBe(
      tokenColorOf('warning-strong'),
    );
  });

  test('Ultrasの案内を添えず、Ultrasの提供の照会もしない', async () => {
    respond({ entries: [yearEntryOf()] });
    await renderPanel();

    await expect.element(entryButton()).toBeVisible();
    expect(panelText()).not.toContain('なら参加費が免除され');
    await expect
      .element(panel().getByRole('link', { name: '料金を見る' }))
      .not.toBeInTheDocument();
    expect(callsOf(ClientUltrasOfferDocument)).toHaveLength(0);
  });

  test('押すと参加費の購入を作り、その購入の決済画面へ移る', async () => {
    respond({ entries: [yearEntryOf()] });
    const router = await renderPanel();

    await userEvent.click(entryButton());

    await expect
      .poll(() => router.state.location.pathname)
      .toBe(`/checkout/${YEAR_ENTRY_PURCHASE_ID}`);
    expect(callsOf(ClientStartYearTournamentCheckoutDocument)).toHaveLength(1);
    expect(
      callsOf(ClientStartYearTournamentCheckoutDocument)[0]?.[1],
    ).toStrictEqual({ launchId: YEAR_ENTRY_LAUNCH_ID });
  });

  test('参加費を取得できないときは、ボタンを無効にし「現在ご利用いただけません」と閲覧やその他の操作は利用できる旨を示す', async () => {
    respond({ entries: [yearEntryOf({ fee: null })] });
    await renderPanel();

    await expect.element(entryButton()).toBeDisabled();
    await expect
      .element(entryButton())
      .toHaveAccessibleName('Yearトーナメントに参加');
    await expect
      .element(entryButton())
      .toHaveAccessibleDescription(
        `現在ご利用いただけません。 ${UNAVAILABLE_REASON}`,
      );
    await expect
      .element(panel().getByRole('status'))
      .toHaveTextContent(`現在ご利用いただけません。${UNAVAILABLE_REASON}`);
    await expect.element(panel().getByText(INTRO)).toBeVisible();
    await userEvent.click(entryButton(), { force: true });
    expect(callsOf(ClientStartYearTournamentCheckoutDocument)).toHaveLength(0);
  });

  test('押した後に決済サービスの障害が返ると、ボタンを無効にし障害の案内を示す', async () => {
    respond({
      entries: [yearEntryOf()],
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
      entries: [yearEntryOf()],
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
    ['year_entry_not_found', 'このYearトーナメントの参加枠は見つかりません。'],
    [
      'year_entry_already_entitled',
      'このプロダクトはYearトーナメントの参加資格を得ています。',
    ],
    ['year_entry_closed', CLOSED_MESSAGE],
    [
      'year_entry_product_unavailable',
      'このプロダクトは現在Yearトーナメントに参加できません。',
    ],
    ['year_entry_exempt', 'Ultrasの特典により参加費は免除されます。'],
  ])(
    '押した後に%sが返ると、サーバーの理由の文言をボタンの近くに示す',
    async (code, message) => {
      respond({
        entries: [yearEntryOf()],
        checkout: failureOf(code, 422, message),
      });
      await renderPanel();

      await userEvent.click(entryButton());

      await expect.element(alert()).toHaveTextContent(message);
      await expect.element(entryButton()).toBeEnabled();
    },
  );

  test('受付期限の境界で取り直し、受付の終了を示してボタンを出さない', async () => {
    const shortly = serverTimeBeforeAcceptUntil(10 * SECOND_MS);
    startClockAt(shortly);
    respond({
      entries: [
        yearEntryOf({ serverTime: shortly }),
        yearEntryOf({
          fee: null,
          serverTime: serverTimeBeforeAcceptUntil(-SECOND_MS),
        }),
      ],
    });
    await renderPanel();

    await expect.element(entryButton()).toBeVisible();
    await vi.advanceTimersByTimeAsync(11 * SECOND_MS);

    await expect.element(panel().getByText(CLOSED_MESSAGE)).toBeVisible();
    await expect.element(entryButton()).not.toBeInTheDocument();
    expect(callsOf(ClientMyYearEntryDocument)).toHaveLength(2);
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
      expect(panelText()).not.toContain('Product of the Week受賞により');
    },
  );

  test('受付期限の後で組み合わせ決定の前の支払い待ちは、受付の終了を示す', async () => {
    respond({ entries: [CLOSED_AWAITING_ENTRY] });
    await renderPanel();

    await expect.element(panel()).toBeVisible();
    expect(panelText()).toBe(`${TITLE}${CLOSED_MESSAGE}`);
    await expect.element(entryButton()).not.toBeInTheDocument();
  });

  test('決済で参加資格を得た枠は、参加資格を得た旨と組み合わせ決定の日時を示す', async () => {
    respond({ entries: [PAID_ENTITLED_ENTRY] });
    await renderPanel();

    await expect.element(panel()).toBeVisible();
    expect(panelText()).toBe(
      `${TITLE}参加資格を得ました。組み合わせは5月25日(火) 16:45に決定します。`,
    );
    expect(
      document.querySelector(`time[datetime="${YEAR_ENTRY_DRAW_AT}"]`),
    ).not.toBeNull();
  });

  test.each([
    ['勝ち残り', ALIVE_ENTRY, '組み合わせに参加しています。'],
    ['敗退', ELIMINATED_ENTRY, '準決勝で敗退しました。'],
    ['優勝', CHAMPION_ENTRY, 'Product of the Yearを受賞しました。'],
  ])(
    '組み合わせに入った枠(%s)は、その状態とブラケットのページへの導線を示す',
    async (_name, entry, message) => {
      respond({ entries: [entry] });
      await renderPanel();

      await expect.element(panel().getByText(message)).toBeVisible();
      await expect
        .element(panel().getByRole('link', { name: 'ブラケットを見る' }))
        .toHaveAttribute('href', YEAR_ENTRY_BRACKET_PATH);
    },
  );

  test.each([
    [
      '期限切れ',
      closedEntryOf('EXPIRED', 'DEADLINE'),
      '決済期限までに参加費の決済が無かったため参加できませんでした。',
    ],
    [
      '組み合わせ決定の後のWeek優勝の反映による期限切れ',
      closedEntryOf('EXPIRED', 'LATE_ENTRY'),
      '組み合わせ決定の後にWeek優勝が反映されたため参加できませんでした。',
    ],
    [
      '返金の対象の資格の喪失',
      closedEntryOf('FORFEITED', 'DELETED', true),
      `プロダクトの削除により参加資格を失いました。${REFUND_SUFFIX}`,
    ],
    [
      '返金の対象でない資格の喪失',
      closedEntryOf('FORFEITED', 'DELETED', false),
      'プロダクトの削除により参加資格を失いました。',
    ],
    [
      '返金の対象の非公開化・停止による除外',
      closedEntryOf('EXCLUDED', 'HIDDEN_OR_SUSPENDED', true),
      `組み合わせ決定の時点でプロダクトが公開されていなかったため参加できませんでした。${REFUND_SUFFIX}`,
    ],
    [
      '返金の対象でない非公開化・停止による除外',
      closedEntryOf('EXCLUDED', 'HIDDEN_OR_SUSPENDED', false),
      '組み合わせ決定の時点でプロダクトが公開されていなかったため参加できませんでした。',
    ],
    [
      '返金の対象の参加数の上限による除外',
      closedEntryOf('EXCLUDED', 'OVER_CAPACITY', true),
      `参加数の上限(64)を超えたため参加できませんでした。${REFUND_SUFFIX}`,
    ],
    [
      '返金の対象でない参加数の上限による除外',
      closedEntryOf('EXCLUDED', 'OVER_CAPACITY', false),
      '参加数の上限(64)を超えたため参加できませんでした。',
    ],
  ])(
    '%sの枠は、その旨を示しボタンを出さない',
    async (_name, entry, message) => {
      respond({ entries: [entry] });
      await renderPanel();

      await expect.element(panel()).toBeVisible();
      expect(panelText()).toBe(`${TITLE}${message}`);
      await expect.element(entryButton()).not.toBeInTheDocument();
    },
  );
});

describe('YearEntryPanelのアクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '受付期限まで48時間未満で取得できない参加費の案内を出した状態で自動検査の違反が無い(%s)',
    async (scheme) => {
      applyColorScheme(scheme);
      respond({
        entries: [
          yearEntryOf({
            fee: null,
            serverTime: serverTimeBeforeAcceptUntil(HOUR_MS),
          }),
        ],
      });
      await renderPanel();

      await expect.element(panel().getByRole('status')).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '押した後の拒否の文言を出した状態で自動検査の違反が無い(%s)',
    async (scheme) => {
      applyColorScheme(scheme);
      respond({
        entries: [yearEntryOf()],
        checkout: failureOf(
          'year_entry_product_unavailable',
          422,
          'このプロダクトは現在Yearトーナメントに参加できません。',
        ),
      });
      await renderPanel();
      await userEvent.click(entryButton());
      await expect.element(alert()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each([
    EXEMPT_AWAITING_ENTRY,
    ELIMINATED_ENTRY,
    closedEntryOf('EXCLUDED', 'OVER_CAPACITY', true),
  ])('状態の表示で自動検査の違反が無い(%#)', async (entry) => {
    respond({ entries: [entry] });
    await renderPanel();

    await expect.element(panel()).toBeVisible();
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('区画の取得の失敗の表示で自動検査の違反が無い', async () => {
    respond({
      entries: [failureOf('internal_error', 500, SLOT_FAILURE_MESSAGE)],
    });
    await renderPanel();

    await expect
      .element(page.getByRole('button', { name: '再試行' }))
      .toBeVisible();
    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
