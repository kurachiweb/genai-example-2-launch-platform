import { notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import {
  computePeriodWindows,
  type SponsorshipDatePeriod,
  type SponsorshipDateWindow,
} from '../../../common-lib/sponsorship/sponsorship-period.ts';
import type { SponsorshipTier } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { addBusinessDays } from '../../../common-lib/time/business-date-arithmetic.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  ClientSponsorshipPeriodWindowDocument,
  type ClientSponsorshipPeriodWindowQuery,
  type ClientSponsorshipPeriodWindowQueryVariables,
} from '../../graphql/generated/graphql.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { BOUNDARY_REFRESH_DELAY_MS } from '../time/use-boundary-refresh.ts';
import {
  SponsorshipPeriodField,
  type SponsorshipPeriodFieldValues,
} from './sponsorship-period-field.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

// 業務日付2026-11-18の12:00(UTC-08:00)。東京では2026-11-19の5:00で、ローカルの日付が業務日付と食い違う
const NOW = new Date('2026-11-18T20:00:00.000Z');
// 業務日付2026-11-19の0:00の1分前
const BEFORE_MIDNIGHT = new Date('2026-11-19T07:59:00.000Z');

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const PRODUCT_ID = '01JD0PR0DVCT000000000000000';

const START_REASON = '開始日は今日から1年以内の日付を選んでください。';
const END_REASON =
  '終了日は開始日から366日以内の、開始日以降の日付を選んでください。';
const OVERLAP_REASON = '同じティアの広告の掲載期間と重なるため選べません。';
const INELIGIBLE_MESSAGE = 'このプロダクトはスポンサー広告を申し込めません。';

const START_LABEL = '開始日(必須)';
const END_LABEL = '終了日(必須)';
const FORM_LABEL = '掲載期間の欄の確認';
const SUBMIT_LABEL = '送信';

const PAID_PERIOD: SponsorshipDatePeriod = {
  startsOn: '2026-11-28',
  endsOn: '2026-12-04',
};

const SCHEMA = z.object({
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
});

type SubmitMock = ReturnType<
  typeof vi.fn<(values: SponsorshipPeriodFieldValues) => void>
>;

interface TestFormProps {
  readonly defaults: SponsorshipPeriodFieldValues;
  readonly onSubmit: SubmitMock;
  readonly productId: string | null;
  readonly tier: SponsorshipTier | null;
  readonly disabled: boolean;
}

function TestForm({
  defaults,
  onSubmit,
  productId,
  tier,
  disabled,
}: TestFormProps) {
  const form = useAppForm<
    SponsorshipPeriodFieldValues,
    SponsorshipPeriodFieldValues
  >(SCHEMA, { defaultValues: defaults });
  return (
    <AppForm
      form={form}
      aria-label={FORM_LABEL}
      serverFieldPrefix="input"
      onSubmit={onSubmit}
      onSubmitError={() => undefined}
      className="flex flex-col gap-6 p-4"
    >
      <SponsorshipPeriodField
        viewer={VIEWER}
        productId={productId}
        tier={tier}
        disabled={disabled}
      />
      <SubmitButton className="self-start">{SUBMIT_LABEL}</SubmitButton>
    </AppForm>
  );
}

let serverToday = '2026-11-18';
let paidPeriods: readonly SponsorshipDatePeriod[] = [PAID_PERIOD];
let failure: Error | null = null;

const toView = ({ earliest, latest, unavailable }: SponsorshipDateWindow) => ({
  earliest,
  latest,
  unavailable: unavailable.map(({ from, to }) => ({
    from,
    to,
    reason: 'OVERLAP' as const,
  })),
});

// サーバーと同じ規則で、今日・開始日・決済済みの掲載期間から選べる範囲を返す
const respond = (
  document: unknown,
  variables: ClientSponsorshipPeriodWindowQueryVariables,
) => {
  if (document !== ClientSponsorshipPeriodWindowDocument) {
    return Promise.reject(new Error('想定外の操作です。'));
  }
  if (failure instanceof GraphQLClientError) {
    return Promise.resolve({ ok: false, error: failure });
  }
  if (failure !== null) {
    return Promise.reject(failure);
  }
  const windows = computePeriodWindows({
    today: serverToday,
    startsOn: variables.startsOn ?? null,
    paidPeriods,
  });
  const data: ClientSponsorshipPeriodWindowQuery = {
    sponsorshipPeriodWindow: {
      businessToday: serverToday,
      nextDayStartsAt: `${addBusinessDays(serverToday, 1)}T08:00:00.000Z`,
      start: toView(windows.start),
      end: windows.end === null ? null : toView(windows.end),
    },
  };
  return Promise.resolve({ ok: true, data });
};

const windowCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientSponsorshipPeriodWindowDocument,
  );

interface RenderOptions {
  readonly defaults?: SponsorshipPeriodFieldValues;
  readonly productId?: string | null;
  readonly tier?: SponsorshipTier | null;
  readonly disabled?: boolean;
  readonly display?: DisplayPreferences;
  readonly now?: Date;
  readonly fakeTimeouts?: boolean;
}

async function renderField({
  defaults = { startsOn: null, endsOn: null },
  productId = PRODUCT_ID,
  tier = 'gold',
  disabled = false,
  display = TOKYO_JA,
  now = NOW,
  fakeTimeouts = false,
}: RenderOptions = {}): Promise<SubmitMock> {
  if (fakeTimeouts) {
    notifyManager.setScheduler(queueMicrotask);
  }
  vi.useFakeTimers({
    now,
    toFake: fakeTimeouts ? ['Date', 'setTimeout', 'clearTimeout'] : ['Date'],
  });
  await emulateBrowserDisplay(display);
  const onSubmit: SubmitMock = vi.fn();
  await renderInRouter(
    <DisplayPreferencesProvider initial={{ ...display }}>
      <TooltipProvider>
        <TestForm
          defaults={defaults}
          onSubmit={onSubmit}
          productId={productId}
          tier={tier}
          disabled={disabled}
        />
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    { context: createPageRouterContext('local') },
  );
  return onSubmit;
}

const form = () => page.getByRole('form', { name: FORM_LABEL });
const startGroup = () => page.getByRole('group', { name: START_LABEL });
const endGroup = () => page.getByRole('group', { name: END_LABEL });
const startDay = (name: string) =>
  startGroup().getByRole('button', { name, exact: true });
const endDay = (name: string) =>
  endGroup().getByRole('button', { name, exact: true });
const tooltip = () => page.getByRole('tooltip');
const retryButton = () => page.getByRole('button', { name: '再試行' });
const submitButton = () =>
  page.getByRole('button', { name: SUBMIT_LABEL, exact: true });

const submitted = async (onSubmit: SubmitMock) => {
  await userEvent.click(submitButton());
  await expect.poll(() => onSubmit.mock.calls).toHaveLength(1);
  return onSubmit.mock.calls[0]?.[0];
};

const timesIn = (group: ReturnType<typeof page.getByRole>) =>
  Array.from(
    group
      .element()
      .closest('[data-slot="form-field"]')
      ?.querySelectorAll<HTMLTimeElement>('p time') ?? [],
    (time) => time.dateTime,
  );

const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

beforeEach(() => {
  serverToday = '2026-11-18';
  paidPeriods = [PAID_PERIOD];
  failure = null;
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation(respond);
});

afterEach(async () => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('開始日の選べない日', () => {
  test('今日より前の日と決済済みの掲載期間の日は、フォーカスできる無効の日として理由をツールチップと読み上げ用の文言で示し、押しても選ばれない', async () => {
    const onSubmit = await renderField();
    const today = startDay('今日、2026年11月18日水曜日');
    await expect.element(today).not.toHaveAttribute('aria-disabled');
    await expect.element(endGroup()).not.toBeInTheDocument();

    today.element().focus();
    await userEvent.keyboard('{ArrowLeft}');

    const past = startDay(`2026年11月17日火曜日、${START_REASON}`);
    await expect.element(past).toHaveFocus();
    await expect.element(past).toHaveAttribute('aria-disabled', 'true');
    await expect.element(tooltip()).toHaveTextContent(START_REASON);

    await expect
      .element(startDay(`2026年11月28日土曜日、${OVERLAP_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await startGroup().getByRole('button', { name: '次の月へ' }).click();
    const overlap = startDay(`2026年12月4日金曜日、${OVERLAP_REASON}`);
    await expect.element(overlap).toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(startDay('2026年12月5日土曜日'))
      .not.toHaveAttribute('aria-disabled');

    await overlap.click({ force: true });
    await expect.element(tooltip()).toHaveTextContent(OVERLAP_REASON);
    expect(await submitted(onSubmit)).toEqual({ startsOn: null, endsOn: null });
    expect(windowCalls().map(([, variables]: unknown[]) => variables)).toEqual([
      { productId: PRODUCT_ID, tier: 'GOLD' },
    ]);
  });

  test('365日後より後の日は、開始日の範囲の外の理由を示す', async () => {
    await renderField();
    const next = startGroup().getByRole('button', { name: '次の月へ' });
    for (let month = 0; month < 12; month += 1) {
      await next.click();
    }

    await expect
      .element(startDay('2027年11月18日木曜日'))
      .not.toHaveAttribute('aria-disabled');
    await expect
      .element(startDay(`2027年11月19日金曜日、${START_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(next).toBeDisabled();
  });
});

describe('終了日', () => {
  test('開始日を選ぶと開始日付きで範囲を受け取り、終了日のカレンダーで開始日より前と重なる日を理由とともに示し、選んだ日を業務日付のtime要素で示す', async () => {
    const onSubmit = await renderField();

    await startDay('2026年11月20日金曜日').click();

    await expect
      .element(endDay(`2026年11月19日木曜日、${END_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(endDay(`2026年11月28日土曜日、${OVERLAP_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    expect(windowCalls().at(-1)?.[1]).toEqual({
      productId: PRODUCT_ID,
      tier: 'GOLD',
      startsOn: '2026-11-20',
    });
    await endDay('2026年11月27日金曜日').click();

    await expect
      .element(endDay('2026年11月27日金曜日、選択済み'))
      .toBeInTheDocument();
    await expect.element(startGroup()).toHaveAccessibleDescription('11月20日');
    await expect.element(endGroup()).toHaveAccessibleDescription('11月27日');
    expect(timesIn(startGroup())).toEqual(['2026-11-20']);
    expect(timesIn(endGroup())).toEqual(['2026-11-27']);
    expect(await submitted(onSubmit)).toEqual({
      startsOn: '2026-11-20',
      endsOn: '2026-11-27',
    });
  });

  test('決済済みの掲載期間が翌月の1日から始まるときも、終了日のカレンダーで最も遅い日の後の重なりの日へ移れ、開始日+365日の月より先へは移れない', async () => {
    paidPeriods = [{ startsOn: '2026-12-01', endsOn: '2026-12-07' }];
    await renderField({
      defaults: { startsOn: '2026-11-20', endsOn: null },
    });
    await expect
      .element(endDay('2026年11月30日月曜日'))
      .not.toHaveAttribute('aria-disabled');
    const next = endGroup().getByRole('button', { name: '次の月へ' });

    await next.click();
    await expect
      .element(endDay(`2026年12月1日火曜日、${OVERLAP_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    for (let month = 1; month < 12; month += 1) {
      await next.click();
    }

    await expect
      .element(endGroup().getByRole('grid', { name: '2027年11月' }))
      .toBeInTheDocument();
    await expect
      .element(endDay(`2027年11月20日土曜日、${OVERLAP_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(endDay(`2027年11月21日日曜日、${END_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(next).toBeDisabled();
  });

  test('開始日を選び直したら、新しい範囲の外になった終了日の選択を外し、範囲の中の終了日は残す', async () => {
    const onSubmit = await renderField({
      defaults: { startsOn: '2026-11-20', endsOn: '2026-11-27' },
    });
    await expect
      .element(endDay('2026年11月27日金曜日、選択済み'))
      .toBeInTheDocument();

    await startDay('2026年11月25日水曜日').click();
    await expect
      .element(startDay('2026年11月25日水曜日、選択済み'))
      .toBeInTheDocument();
    await expect
      .element(endDay(`2026年11月24日火曜日、${END_REASON}`))
      .toBeInTheDocument();
    await expect
      .element(endDay('2026年11月27日金曜日、選択済み'))
      .toBeInTheDocument();

    await startGroup().getByRole('button', { name: '次の月へ' }).click();
    await startDay('2026年12月10日木曜日').click();
    await expect
      .element(endDay(`2026年12月9日水曜日、${END_REASON}`))
      .toBeInTheDocument();
    await expect.element(endGroup()).not.toHaveAccessibleDescription();
    expect(
      endGroup()
        .getByRole('button', { name: /選択済み/ })
        .query(),
    ).toBeNull();

    expect(await submitted(onSubmit)).toEqual({
      startsOn: '2026-12-10',
      endsOn: null,
    });
  });

  test('必須の欄のため、選んだ開始日と終了日をもう一度押しても選択を外さない', async () => {
    const onSubmit = await renderField();

    await startDay('2026年11月20日金曜日').click();
    await startDay('2026年11月20日金曜日、選択済み').click();
    await endDay('2026年11月22日日曜日').click();
    await endDay('2026年11月22日日曜日、選択済み').click();

    await expect
      .element(startDay('2026年11月20日金曜日、選択済み'))
      .toBeInTheDocument();
    await expect
      .element(endDay('2026年11月22日日曜日、選択済み'))
      .toBeInTheDocument();
    expect(await submitted(onSubmit)).toEqual({
      startsOn: '2026-11-20',
      endsOn: '2026-11-22',
    });
  });

  test('選んだ開始日が選べない日なら終了日の範囲が返らないため、開始日に理由を示し、終了日のカレンダーを閉じて入力中の値を残す', async () => {
    const onSubmit = await renderField({
      defaults: { startsOn: '2026-12-03', endsOn: '2026-12-10' },
    });

    await expect
      .element(startDay(`2026年12月3日木曜日、選択済み、${OVERLAP_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(startGroup())
      .toHaveAccessibleDescription(`12月3日 ${OVERLAP_REASON}`);
    expect(endGroup().query()).toBeNull();

    expect(await submitted(onSubmit)).toEqual({
      startsOn: '2026-12-03',
      endsOn: '2026-12-10',
    });
  });
});

describe('業務日付とローカルの日付の食い違い', () => {
  test.each(['Pacific/Honolulu', 'Pacific/Kiritimati'])(
    '利用者のタイムゾーンが%sでも、今日の印・表示を始める月・選んだ日を業務日付のまま示す',
    async (timeZone) => {
      const onSubmit = await renderField({
        display: { timeZone, locale: 'ja-JP' },
      });

      await expect
        .element(startDay('今日、2026年11月18日水曜日'))
        .toBeInTheDocument();
      await expect
        .element(startGroup().getByRole('grid', { name: '2026年11月' }))
        .toBeInTheDocument();
      await startDay('2026年11月20日金曜日').click();
      await expect
        .element(endDay('今日、2026年11月18日水曜日、' + END_REASON))
        .toBeInTheDocument();
      await endDay('2026年11月21日土曜日').click();

      expect(timesIn(startGroup())).toEqual(['2026-11-20']);
      expect(timesIn(endGroup())).toEqual(['2026-11-21']);
      expect(await submitted(onSubmit)).toEqual({
        startsOn: '2026-11-20',
        endsOn: '2026-11-21',
      });
    },
  );
});

describe('表示中の0:00の取り直し', () => {
  test('0:00を越えるとその時刻のタイマーで範囲を取り直し、入力中の値を消さずに、選べなくなった開始日に理由を示して終了日のカレンダーを閉じる', async () => {
    const onSubmit = await renderField({
      defaults: { startsOn: '2026-11-18', endsOn: '2026-11-20' },
      now: BEFORE_MIDNIGHT,
      fakeTimeouts: true,
    });
    await expect
      .element(startDay('今日、2026年11月18日水曜日、選択済み'))
      .not.toHaveAttribute('aria-disabled');
    await expect
      .element(endDay('2026年11月20日金曜日、選択済み'))
      .toBeInTheDocument();

    serverToday = '2026-11-19';
    await vi.advanceTimersByTimeAsync(60_000 + BOUNDARY_REFRESH_DELAY_MS - 1);
    expect(windowCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect
      .element(startDay(`2026年11月18日水曜日、選択済み、${START_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(startDay('今日、2026年11月19日木曜日'))
      .toBeInTheDocument();
    await expect.element(endGroup()).not.toBeInTheDocument();
    expect(windowCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(windowCalls()).toHaveLength(2);

    vi.useRealTimers();
    notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
    expect(await submitted(onSubmit)).toEqual({
      startsOn: '2026-11-18',
      endsOn: '2026-11-20',
    });
  });

  test('取り直しで選んでいる終了日が重なるようになったら、選択を残したまま理由を示す', async () => {
    const onSubmit = await renderField({
      defaults: { startsOn: '2026-11-20', endsOn: '2026-11-27' },
      now: BEFORE_MIDNIGHT,
      fakeTimeouts: true,
    });
    await expect
      .element(endDay('2026年11月27日金曜日、選択済み'))
      .toBeInTheDocument();

    serverToday = '2026-11-19';
    paidPeriods = [
      { startsOn: '2026-11-25', endsOn: '2026-11-26' },
      PAID_PERIOD,
    ];
    await vi.advanceTimersByTimeAsync(60_000 + BOUNDARY_REFRESH_DELAY_MS);

    await expect
      .element(endDay(`2026年11月27日金曜日、選択済み、${OVERLAP_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(endGroup())
      .toHaveAccessibleDescription(`11月27日 ${OVERLAP_REASON}`);
    await expect
      .element(startDay('2026年11月20日金曜日、選択済み'))
      .not.toHaveAttribute('aria-disabled');

    vi.useRealTimers();
    notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
    expect(await submitted(onSubmit)).toEqual({
      startsOn: '2026-11-20',
      endsOn: '2026-11-27',
    });
  });

  test('選んでいる開始日をもう一度押した後の取り直しでも、重なるようになった終了日の選択を残して理由を示す', async () => {
    const onSubmit = await renderField({
      defaults: { startsOn: '2026-11-20', endsOn: '2026-11-27' },
      now: BEFORE_MIDNIGHT,
      fakeTimeouts: true,
    });
    await expect
      .element(endDay('2026年11月27日金曜日、選択済み'))
      .toBeInTheDocument();
    await startDay('2026年11月20日金曜日、選択済み').click();

    serverToday = '2026-11-19';
    paidPeriods = [
      { startsOn: '2026-11-25', endsOn: '2026-11-26' },
      PAID_PERIOD,
    ];
    await vi.advanceTimersByTimeAsync(60_000 + BOUNDARY_REFRESH_DELAY_MS);

    await expect
      .element(endDay(`2026年11月27日金曜日、選択済み、${OVERLAP_REASON}`))
      .toHaveAttribute('aria-disabled', 'true');
    await vi.advanceTimersByTimeAsync(0);
    await expect
      .element(endGroup())
      .toHaveAccessibleDescription(`11月27日 ${OVERLAP_REASON}`);

    vi.useRealTimers();
    notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
    expect(await submitted(onSubmit)).toEqual({
      startsOn: '2026-11-20',
      endsOn: '2026-11-27',
    });
  });
});

describe('照会の失敗', () => {
  test('APIサーバーが返したエラーの文言と再試行のボタンを欄の位置に示し、再試行で範囲を示す', async () => {
    failure = new GraphQLClientError({
      code: 'sponsorship_product_ineligible',
      message: INELIGIBLE_MESSAGE,
      status: 200,
    });
    await renderField();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(INELIGIBLE_MESSAGE);
    expect(startGroup().query()).toBeNull();

    failure = null;
    await retryButton().click();

    await expect
      .element(startDay('今日、2026年11月18日水曜日'))
      .toBeInTheDocument();
    expect(page.getByRole('alert').query()).toBeNull();
  });

  test('エラーコードを持たない失敗は、想定外の失敗の文言を示す', async () => {
    failure = new Error('通信が切断されました。');
    await renderField();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE);
    await expect.element(retryButton()).toBeVisible();
  });
});

describe('範囲を照会しない場合', () => {
  test.each([
    { name: 'プロダクト', productId: null, tier: 'gold' as const },
    { name: 'ティア', productId: PRODUCT_ID, tier: null },
  ])(
    '$nameが決まるまでは範囲を照会せず、カレンダーを示さない',
    async ({ productId, tier }) => {
      await renderField({ productId, tier });

      await expect.element(submitButton()).toBeVisible();
      expect(page.getByRole('group').query()).toBeNull();
      expect(windowCalls()).toHaveLength(0);
    },
  );

  test('無効の欄では日を選べない', async () => {
    await renderField({
      defaults: { startsOn: '2026-11-20', endsOn: null },
      disabled: true,
    });

    await expect.element(startDay('2026年11月21日土曜日')).toBeDisabled();
    await expect.element(endDay('2026年11月21日土曜日')).toBeDisabled();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test('開始日と終了日を選び、選べない日の理由のツールチップを示した状態で、アクセシビリティの検査の違反が0件', async () => {
    await renderField({
      defaults: { startsOn: '2026-11-20', endsOn: '2026-11-27' },
    });
    const overlap = endDay(`2026年11月28日土曜日、${OVERLAP_REASON}`);
    await userEvent.hover(overlap);
    await expect.element(tooltip()).toBeVisible();

    expect(await runAxe(form().element())).toStrictEqual([]);
  });

  test('選んでいる開始日が選べず終了日のカレンダーを閉じた状態で、アクセシビリティの検査の違反が0件', async () => {
    await renderField({
      defaults: { startsOn: '2026-12-03', endsOn: null },
    });
    await expect
      .element(startDay(`2026年12月3日木曜日、選択済み、${OVERLAP_REASON}`))
      .toBeInTheDocument();

    expect(await runAxe(form().element())).toStrictEqual([]);
  });

  test('照会の失敗を示した状態で、アクセシビリティの検査の違反が0件', async () => {
    failure = new Error('通信が切断されました。');
    await renderField();
    await expect.element(retryButton()).toBeVisible();

    expect(await runAxe(form().element())).toStrictEqual([]);
  });
});
