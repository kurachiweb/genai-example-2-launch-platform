import { notifyManager, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import type { RouterContext } from '../../../lib/start/router-context.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  ClientNewProductLaunchWindowDocument,
  type ClientNewProductLaunchWindowQuery,
  ClientUltrasOfferDocument,
  type ClientUltrasOfferQuery,
} from '../../graphql/generated/graphql.ts';
import {
  type LaunchDateWindowView,
  type LaunchPlanView,
  newProductLaunchWindowQueryOptions,
  toLaunchDateWindowView,
} from '../../graphql/my-products.ts';
import { LaunchDateField } from './launch-date-field.tsx';
import type { LaunchDateFieldValues } from './launch-date-field-values.ts';
import { ultrasOfferQueryOptions } from '../../graphql/ultras.ts';
import { BOUNDARY_REFRESH_DELAY_MS } from './use-boundary-refresh.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

// 業務日付2026-11-09の15:00(UTC-08:00)。東京では2026-11-10の8:00
const NOW = new Date('2026-11-09T23:00:00.000Z');
// 業務日付2026-11-09の23:40(選べる日の締め切り)
const SELECTION_CUTOFF = new Date('2026-11-10T07:40:00.000Z');

const VIEWER_ID = '01JD00000000000000000000V1';

const REQUIRED_MESSAGE = 'ローンチ日を選んでください。';
const DEADLINE_REASON = 'ペアリングの締め切りを過ぎています';
const INTERVAL_REASON = '敗北後の間隔のため選べません';
const OUT_OF_RANGE_REASON = '選べる期間の外です';
const ULTRAS_PROMOTION = 'Ultrasなら敗北後2日で再ローンチできます。';
const LOCK_MESSAGE =
  'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。';
const HIDDEN_MESSAGE =
  'このプロダクトは公開が停止されているため、ローンチを予約できません。';
const UNKNOWN_MESSAGE = 'ローンチの状態を確認できませんでした。';

const FORM_LABEL = 'ローンチ日の欄の確認';
const SUBMIT_LABEL = '送信';

const OUT_OF_RANGE_DAY = {
  from: '2027-02-08',
  to: '2027-02-08',
  reason: 'out_of_range',
} as const;

// 締め切りの前の、敗北後の間隔の掛からない選べる日
const REGISTER_WINDOW: LaunchDateWindowView = {
  earliest: '2026-11-10',
  latest: '2027-02-07',
  unavailable: [
    { from: '2026-11-09', to: '2026-11-09', reason: 'pairing_deadline' },
    OUT_OF_RANGE_DAY,
  ],
  relaunchIntervalDays: null,
};

// 2026-11-05の予選で敗北し、7日の間隔で最も早い日が2026-11-12へずれる
const INTERVAL_WINDOW: LaunchDateWindowView = {
  earliest: '2026-11-12',
  latest: '2027-02-07',
  unavailable: [
    { from: '2026-11-09', to: '2026-11-09', reason: 'pairing_deadline' },
    { from: '2026-11-10', to: '2026-11-11', reason: 'relaunch_interval' },
    OUT_OF_RANGE_DAY,
  ],
  relaunchIntervalDays: 7,
};

const planOf = (overrides: Partial<LaunchPlanView>): LaunchPlanView => ({
  mode: 'new',
  currentLaunchDate: null,
  window: REGISTER_WINDOW,
  blocks: [],
  locked: false,
  locks: [],
  lockUnknown: false,
  ultrasEntitled: false,
  ...overrides,
});

const RESCHEDULE_PLAN = planOf({
  mode: 'reschedule',
  currentLaunchDate: '2026-11-20',
});

const OPTIONAL_SCHEMA = z.object({ launchDate: z.string().nullable() });
const REQUIRED_SCHEMA = z.object({
  launchDate: z.string({ error: REQUIRED_MESSAGE }),
});

type SubmitMock = ReturnType<
  typeof vi.fn<(values: { readonly launchDate: string | null }) => void>
>;

interface TestFormProps {
  readonly required: boolean;
  readonly defaultValue: string | null;
  readonly onSubmit: SubmitMock;
  readonly children: ReactNode;
}

function TestForm({
  required,
  defaultValue,
  onSubmit,
  children,
}: TestFormProps) {
  const form = useAppForm<LaunchDateFieldValues, { launchDate: string | null }>(
    required ? REQUIRED_SCHEMA : OPTIONAL_SCHEMA,
    { defaultValues: { launchDate: defaultValue } },
  );
  return (
    <AppForm
      form={form}
      aria-label={FORM_LABEL}
      serverFieldPrefix="input"
      onSubmit={onSubmit}
      onSubmitError={() => undefined}
      className="flex flex-col gap-6 p-4"
    >
      {children}
      <SubmitButton className="self-start">{SUBMIT_LABEL}</SubmitButton>
    </AppForm>
  );
}

const offerOf = (promotionEnabled: boolean): ClientUltrasOfferQuery => ({
  ultrasOffer: {
    price: { amount: 999, currency: 'usd' },
    priceStale: false,
    promotionEnabled,
  },
});

const toGraphQLWindow = (
  window: LaunchDateWindowView,
): ClientNewProductLaunchWindowQuery => ({
  newProductLaunchWindow: {
    earliest: window.earliest,
    latest: window.latest,
    relaunchIntervalDays: window.relaunchIntervalDays,
    unavailable: window.unavailable.map(({ from, to, reason }) => ({
      from,
      to,
      reason:
        reason === 'pairing_deadline'
          ? 'PAIRING_DEADLINE'
          : reason === 'relaunch_interval'
            ? 'RELAUNCH_INTERVAL'
            : 'OUT_OF_RANGE',
    })),
  },
});

let promotionEnabled = true;
let launchWindow: LaunchDateWindowView = REGISTER_WINDOW;

const respond = (document: unknown) => {
  if (document === ClientUltrasOfferDocument) {
    return Promise.resolve({ ok: true, data: offerOf(promotionEnabled) });
  }
  if (document === ClientNewProductLaunchWindowDocument) {
    return Promise.resolve({ ok: true, data: toGraphQLWindow(launchWindow) });
  }
  return Promise.reject(new Error('想定外の操作です。'));
};

const windowCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientNewProductLaunchWindowDocument,
  );

interface RenderOptions {
  readonly required?: boolean;
  readonly defaultValue?: string | null;
  readonly display?: DisplayPreferences;
  readonly now?: Date;
  readonly fakeTimeouts?: boolean;
}

async function renderField(
  field: ReactNode,
  {
    required = false,
    defaultValue = null,
    display = TOKYO_JA,
    now = NOW,
    fakeTimeouts = false,
  }: RenderOptions = {},
): Promise<{ readonly onSubmit: SubmitMock; readonly context: RouterContext }> {
  if (fakeTimeouts) {
    notifyManager.setScheduler(queueMicrotask);
  }
  vi.useFakeTimers({
    now,
    toFake: fakeTimeouts ? ['Date', 'setTimeout', 'clearTimeout'] : ['Date'],
  });
  await emulateBrowserDisplay(display);
  const context = createPageRouterContext('local');
  const onSubmit: SubmitMock = vi.fn();
  await renderInRouter(
    <DisplayPreferencesProvider initial={{ ...display }}>
      <TooltipProvider>
        <TestForm
          required={required}
          defaultValue={defaultValue}
          onSubmit={onSubmit}
        >
          {field}
        </TestForm>
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    { context },
  );
  return { onSubmit, context };
}

// 登録画面と同じく、選べる日を取得して欄へ渡す
function RegisterLaunchDate() {
  const { data } = useQuery(newProductLaunchWindowQueryOptions(VIEWER_ID));
  if (data === undefined) {
    return null;
  }
  return (
    <LaunchDateField
      kind="register"
      window={toLaunchDateWindowView(data.newProductLaunchWindow)}
    />
  );
}

const form = () => page.getByRole('form', { name: FORM_LABEL });
const fieldGroup = (name: string) => page.getByRole('group', { name });
const day = (name: string) => page.getByRole('button', { name, exact: true });
const grid = (name: string) => page.getByRole('grid', { name });
const tooltip = () => page.getByRole('tooltip');
const submitButton = () =>
  page.getByRole('button', { name: SUBMIT_LABEL, exact: true });
const pricingLink = () => page.getByRole('link', { name: '料金を見る' });

const submittedLaunchDateOf = (onSubmit: SubmitMock) =>
  onSubmit.mock.calls[0]?.[0].launchDate;

const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

beforeEach(() => {
  promotionEnabled = true;
  launchWindow = REGISTER_WINDOW;
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation(respond);
});

afterEach(async () => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('選べない日', () => {
  test('業務日付の今日と締め切りの前の日・選べる期間の外の日は、フォーカスできる無効の日として理由をツールチップと読み上げ用の文言で示す', async () => {
    await renderField(
      <LaunchDateField kind="register" window={REGISTER_WINDOW} />,
      { required: true },
    );
    const firstAvailable = day('2026年11月10日火曜日');
    await expect.element(firstAvailable).not.toHaveAttribute('aria-disabled');

    firstAvailable.element().focus();
    await userEvent.keyboard('{ArrowLeft}');

    const today = day(`今日、2026年11月9日月曜日、${DEADLINE_REASON}`);
    await expect.element(today).toHaveFocus();
    await expect.element(today).toHaveAttribute('aria-disabled', 'true');
    await expect.element(tooltip()).toHaveTextContent(DEADLINE_REASON);
    await expect
      .element(day(`2026年11月8日日曜日、${DEADLINE_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');

    await page.getByRole('button', { name: '次の月へ' }).click();
    await page.getByRole('button', { name: '次の月へ' }).click();
    await page.getByRole('button', { name: '次の月へ' }).click();
    await expect.element(grid('2027年2月')).toBeInTheDocument();
    await expect
      .element(day('2027年2月7日日曜日'))
      .not.toHaveAttribute('aria-disabled');
    const outOfRange = day(`2027年2月8日月曜日、${OUT_OF_RANGE_REASON}`);
    await expect.element(outOfRange).toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(day(`2027年2月20日土曜日、${OUT_OF_RANGE_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(page.getByRole('button', { name: '次の月へ' }))
      .toBeDisabled();

    await userEvent.hover(outOfRange);
    await expect.element(tooltip()).toHaveTextContent(OUT_OF_RANGE_REASON);
  });

  test('敗北後の間隔の日は、その理由を示し、押しても選ばれない', async () => {
    const { onSubmit } = await renderField(
      <LaunchDateField
        kind="edit"
        plan={planOf({ window: INTERVAL_WINDOW })}
        productHandle="pitch-notes"
      />,
    );
    const interval = day(`2026年11月11日水曜日、${INTERVAL_REASON}`);
    await expect.element(interval).toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(day(`2026年11月10日火曜日、${INTERVAL_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(day('2026年11月12日木曜日'))
      .not.toHaveAttribute('aria-disabled');

    await interval.click({ force: true });
    await expect.element(tooltip()).toHaveTextContent(INTERVAL_REASON);
    await userEvent.click(submitButton());

    await expect.poll(() => onSubmit.mock.calls).toHaveLength(1);
    expect(submittedLaunchDateOf(onSubmit)).toBeNull();
  });
});

describe('選んだ日', () => {
  test('日を選ぶと、ローンチ日を業務日付のまま示し、キックオフの日時を利用者のタイムゾーンのtime要素で相対表現とともに示して、欄の説明として伝える', async () => {
    const { onSubmit } = await renderField(
      <LaunchDateField kind="register" window={REGISTER_WINDOW} />,
      { required: true },
    );

    await day('2026年11月20日金曜日').click();

    await expect
      .element(day('2026年11月20日金曜日、選択済み'))
      .toBeInTheDocument();
    const group = fieldGroup('ローンチ日(必須)');
    await expect
      .element(group)
      .toHaveAccessibleDescription(
        'ローンチ日: 11月20日 キックオフ: 11月20日(金) 17:00(あと10日)',
      );
    const times = form()
      .element()
      .querySelectorAll<HTMLTimeElement>('[data-slot="form-field"] p time');
    expect(Array.from(times, (time) => time.dateTime)).toEqual([
      '2026-11-20',
      '2026-11-20T08:00:00.000Z',
    ]);

    await userEvent.click(submitButton());
    await expect.poll(() => onSubmit.mock.calls).toHaveLength(1);
    expect(submittedLaunchDateOf(onSubmit)).toBe('2026-11-20');
  });

  test.each([
    {
      timeZone: 'Pacific/Honolulu',
      kickoff: 'キックオフ: 11月19日(木) 22:00(あと10日)',
    },
    {
      timeZone: 'Pacific/Kiritimati',
      kickoff: 'キックオフ: 11月20日(金) 22:00(あと10日)',
    },
  ])(
    '利用者のタイムゾーンが$timeZoneでも、今日とローンチ日を業務日付のまま示し、キックオフだけをそのタイムゾーンで示す',
    async ({ timeZone, kickoff }) => {
      const { onSubmit } = await renderField(
        <LaunchDateField kind="register" window={REGISTER_WINDOW} />,
        { required: true, display: { timeZone, locale: 'ja-JP' } },
      );

      await expect
        .element(day(`今日、2026年11月9日月曜日、${DEADLINE_REASON}`))
        .toBeInTheDocument();
      await day('2026年11月20日金曜日').click();

      await expect
        .element(fieldGroup('ローンチ日(必須)'))
        .toHaveAccessibleDescription(`ローンチ日: 11月20日 ${kickoff}`);
      await userEvent.click(submitButton());
      await expect.poll(() => onSubmit.mock.calls).toHaveLength(1);
      expect(submittedLaunchDateOf(onSubmit)).toBe('2026-11-20');
    },
  );

  test('登録では未選択のままフォーカスを外すと選ぶよう示し、選ぶと消す', async () => {
    await renderField(
      <LaunchDateField kind="register" window={REGISTER_WINDOW} />,
      { required: true },
    );

    await userEvent.tab();
    await userEvent.tab();
    await expect
      .element(day(`今日、2026年11月9日月曜日、${DEADLINE_REASON}`))
      .toHaveFocus();
    await userEvent.tab();

    const group = fieldGroup('ローンチ日(必須)');
    await expect.element(group).toHaveAccessibleDescription(REQUIRED_MESSAGE);
    await day('2026年11月20日金曜日').click();
    await expect
      .element(page.getByText(REQUIRED_MESSAGE))
      .not.toBeInTheDocument();
  });

  test('無効の欄では日を選べない', async () => {
    await renderField(
      <LaunchDateField kind="register" window={REGISTER_WINDOW} disabled />,
      { required: true },
    );

    await expect.element(day('2026年11月20日金曜日')).toBeDisabled();
  });
});

describe('Ultrasの導線', () => {
  test('敗北後の間隔が掛かりUltrasの特典を受けていなければ、導線の表示が有効な間、カレンダーの下に料金ページへのリンクを示す', async () => {
    await renderField(
      <LaunchDateField
        kind="edit"
        plan={planOf({ window: INTERVAL_WINDOW })}
        productHandle="pitch-notes"
      />,
    );

    await expect.element(page.getByText(ULTRAS_PROMOTION)).toBeVisible();
    await expect.element(pricingLink()).toHaveAttribute('href', '/pricing');
  });

  test.each([
    {
      name: '導線の表示が無効',
      promotion: false,
      gated: true,
      plan: planOf({ window: INTERVAL_WINDOW }),
    },
    {
      name: 'Ultrasの特典を受けている',
      promotion: true,
      gated: false,
      plan: planOf({
        window: { ...INTERVAL_WINDOW, relaunchIntervalDays: 2 },
        ultrasEntitled: true,
      }),
    },
    {
      name: '敗北後の間隔が掛かっていない',
      promotion: true,
      gated: false,
      plan: planOf({}),
    },
  ])('$nameなら導線を示さない', async ({ promotion, gated, plan }) => {
    promotionEnabled = promotion;
    const { context } = await renderField(
      <LaunchDateField kind="edit" plan={plan} productHandle="pitch-notes" />,
    );

    await expect.element(grid('2026年11月')).toBeInTheDocument();
    await expect
      .poll(
        () =>
          context.queryClient.getQueryState(ultrasOfferQueryOptions().queryKey)
            ?.status,
      )
      .toBe(gated ? 'success' : undefined);
    expect(page.getByText(ULTRAS_PROMOTION).query()).toBeNull();
    expect(pricingLink().query()).toBeNull();
  });

  test('登録では導線を示さない', async () => {
    await renderField(
      <LaunchDateField
        kind="register"
        window={{ ...INTERVAL_WINDOW, relaunchIntervalDays: 7 }}
      />,
      { required: true },
    );

    await expect.element(grid('2026年11月')).toBeInTheDocument();
    expect(page.getByText(ULTRAS_PROMOTION).query()).toBeNull();
  });
});

describe('表示中の境界の取り直し', () => {
  test('表示中に23:40を過ぎると、その時刻のタイマーで選べる日を取り直し、定期には取り直さない', async () => {
    await renderField(<RegisterLaunchDate />, {
      required: true,
      now: new Date(SELECTION_CUTOFF.getTime() - 60_000),
      fakeTimeouts: true,
    });
    const tomorrow = day('2026年11月10日火曜日');
    await expect.element(tomorrow).not.toHaveAttribute('aria-disabled');

    launchWindow = {
      ...REGISTER_WINDOW,
      earliest: '2026-11-11',
      unavailable: [
        { from: '2026-11-09', to: '2026-11-10', reason: 'pairing_deadline' },
        OUT_OF_RANGE_DAY,
      ],
    };
    await vi.advanceTimersByTimeAsync(60_000 + BOUNDARY_REFRESH_DELAY_MS - 1);
    expect(windowCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect
      .element(day(`2026年11月10日火曜日、${DEADLINE_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    expect(windowCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(windowCalls()).toHaveLength(2);
  });
});

describe('計画ごとの表示', () => {
  test('予定のローンチ日を変更できるなら、現在の日を選んだカレンダーを示し、別の日へ変更でき、選んだ日を外せない', async () => {
    const { onSubmit } = await renderField(
      <LaunchDateField
        kind="edit"
        plan={RESCHEDULE_PLAN}
        productHandle="pitch-notes"
      />,
      { defaultValue: '2026-11-20' },
    );

    const current = day('2026年11月20日金曜日、選択済み');
    await expect.element(fieldGroup('ローンチ日(必須)')).toBeInTheDocument();
    await expect.element(current).toBeInTheDocument();
    await current.click();
    await expect.element(current).toBeInTheDocument();

    await day('2026年11月25日水曜日').click();
    await userEvent.click(submitButton());
    await expect.poll(() => onSubmit.mock.calls).toHaveLength(1);
    expect(submittedLaunchDateOf(onSubmit)).toBe('2026-11-25');
  });

  test('予約できるなら「次回のローンチを予約」の欄として示し、選ばずに送ると予約せず、選んだ日を外せる', async () => {
    const { onSubmit } = await renderField(
      <LaunchDateField
        kind="edit"
        plan={planOf({})}
        productHandle="pitch-notes"
      />,
    );

    await expect
      .element(fieldGroup('次回のローンチを予約'))
      .toBeInTheDocument();
    await day('2026年11月20日金曜日').click();
    await day('2026年11月20日金曜日、選択済み').click();
    await expect.element(day('2026年11月20日金曜日')).toBeInTheDocument();

    await userEvent.click(submitButton());
    await expect.poll(() => onSubmit.mock.calls).toHaveLength(1);
    expect(submittedLaunchDateOf(onSubmit)).toBeNull();
  });

  test.each([
    {
      name: '予約できない',
      plan: planOf({
        mode: 'blocked',
        window: null,
        blocks: [
          { code: 'product_hidden', message: HIDDEN_MESSAGE, releaseAt: null },
        ],
      }),
      messages: [HIDDEN_MESSAGE],
    },
    {
      name: '判定に失敗した',
      plan: planOf({ mode: 'unknown', window: null }),
      messages: [UNKNOWN_MESSAGE],
    },
    {
      name: 'マッチ直前・マッチ中の固定の期間',
      plan: planOf({
        ...RESCHEDULE_PLAN,
        locked: true,
        locks: [{ code: 'qualifier_match', message: LOCK_MESSAGE }],
      }),
      messages: [LOCK_MESSAGE],
    },
    {
      name: '固定を判定できない',
      plan: planOf({ lockUnknown: true }),
      messages: [UNKNOWN_MESSAGE],
    },
  ])(
    '$nameなら、カレンダーを出さず予約の案内を示す',
    async ({ plan, messages }) => {
      await renderField(
        <LaunchDateField kind="edit" plan={plan} productHandle="pitch-notes" />,
      );

      for (const message of messages) {
        await expect.element(page.getByText(message)).toBeVisible();
      }
      expect(page.getByRole('grid').query()).toBeNull();
      expect(page.getByRole('group').query()).toBeNull();
      expect(
        page.getByRole('link', { name: '次回のローンチを予約' }).query(),
      ).toBeNull();
      expect(
        page.getByText('ローンチ日は編集画面で変更できます。').query(),
      ).toBeNull();
    },
  );
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test('日を選び、Ultrasの導線と選べない日の理由を示した状態で、アクセシビリティの検査の違反が0件', async () => {
    await renderField(
      <LaunchDateField
        kind="edit"
        plan={planOf({ window: INTERVAL_WINDOW })}
        productHandle="pitch-notes"
      />,
    );
    await day('2026年11月20日金曜日').click();
    await expect.element(pricingLink()).toBeVisible();
    await userEvent.hover(day(`2026年11月11日水曜日、${INTERVAL_REASON}`));
    await expect.element(tooltip()).toBeVisible();

    expect(await runAxe(form().element())).toStrictEqual([]);
  });

  test('選んでいる予定の日が選べなくなった状態で、アクセシビリティの検査の違反が0件', async () => {
    await renderField(
      <LaunchDateField
        kind="edit"
        plan={planOf({
          mode: 'reschedule',
          currentLaunchDate: '2026-11-10',
          window: {
            ...REGISTER_WINDOW,
            earliest: '2026-11-11',
            unavailable: [
              {
                from: '2026-11-09',
                to: '2026-11-10',
                reason: 'pairing_deadline',
              },
              OUT_OF_RANGE_DAY,
            ],
          },
        })}
        productHandle="pitch-notes"
      />,
      { defaultValue: '2026-11-10', now: SELECTION_CUTOFF },
    );

    await expect
      .element(day(`2026年11月10日火曜日、選択済み、${DEADLINE_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');

    expect(await runAxe(form().element())).toStrictEqual([]);
  });

  test('予約の案内を示した状態で、アクセシビリティの検査の違反が0件', async () => {
    await renderField(
      <LaunchDateField
        kind="edit"
        plan={planOf({ mode: 'unknown', window: null })}
        productHandle="pitch-notes"
      />,
    );
    await expect.element(page.getByText(UNKNOWN_MESSAGE)).toBeVisible();

    expect(await runAxe(form().element())).toStrictEqual([]);
  });
});
