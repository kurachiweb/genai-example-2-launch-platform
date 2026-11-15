import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { formatDateTime } from '../../../lib/utilities/datetime/date-time-formats.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import type { UltrasPlanStatus } from '../../graphql/generated/graphql.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import {
  PlanStatusPanel,
  type UltrasPlanView,
  type UltrasPriceView,
} from './plan-status-panel.tsx';

// 加入のボタンが読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const SECTION_TITLE = 'Ultrasの加入状態';
const STATUS_LABEL = '加入状態';
const STARTED_AT_LABEL = '加入の開始日時';
const RENEWAL_AT_LABEL = '次回の更新日時';
const CANCELED_AT_LABEL = '解約の操作の日時';
const BENEFIT_ENDS_AT_LABEL = '特典の終了日時';
const BENEFITS_TITLE = '特典';
const RENEWAL_TITLE = '自動更新と解約';
const SUBSCRIBE_LABEL = 'Ultrasに加入';
const PRICE_UNAVAILABLE = '現在表示できません';
const ACTIVE_GUIDANCE =
  'Ultrasに加入中です。次回の更新日に自動で更新され、月額料金をお支払いいただきます。';
const PAST_DUE_GUIDANCE =
  '毎月のお支払いに失敗したため、お支払いを再試行しています。再試行の間も特典は続きますが、再試行がすべて失敗すると特典は終了します。「解約・支払い方法の管理」から支払い方法を更新してください。';
const CANCELED_GUIDANCE =
  'Ultrasは解約済みです。特典の終了日時まで特典は続き、その後は更新されません。継続するには「解約・支払い方法の管理」から解約を取り消してください。';
const NOT_SUBSCRIBED_MESSAGE = 'Ultrasに加入していません。';
const PROMOTION_CLOSED_MESSAGE = '現在、新規の加入を受け付けていません。';
const AUTO_RENEWAL_NOTE_OF_999 =
  'Ultrasプランは毎月自動で更新され、毎月の更新日に$9.99(税込)を自動でお支払いいただきます。';

const STARTED_AT = '2026-11-01T00:00:00.000Z';
const PERIOD_ENDS_AT = '2026-12-01T00:00:00.000Z';
const CANCELED_AT = '2026-11-10T03:00:00.000Z';

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const NEW_YORK_EN: DisplayPreferences = {
  timeZone: 'America/New_York',
  locale: 'en-US',
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

const PRICE: UltrasPriceView = { amount: 999, currency: 'usd' };

const planOf = (
  status: UltrasPlanStatus,
  overrides: Partial<UltrasPlanView> = {},
): UltrasPlanView => ({
  status,
  startedAt: STARTED_AT,
  currentPeriodEndsAt: PERIOD_ENDS_AT,
  canceledAt: null,
  benefitEndsAt: null,
  ...overrides,
});

const CANCELED_PLAN = planOf('CANCELED', {
  canceledAt: CANCELED_AT,
  benefitEndsAt: PERIOD_ENDS_AT,
});

interface RenderOptions {
  readonly plan: UltrasPlanView | null;
  readonly promotionEnabled?: boolean;
  readonly price?: UltrasPriceView | null;
  readonly display?: DisplayPreferences;
}

const renderPanel = ({
  plan,
  promotionEnabled = false,
  price = PRICE,
  display = TOKYO_JA,
}: RenderOptions) =>
  renderInRouter(
    <DisplayPreferencesProvider initial={display}>
      <main>
        <PlanStatusPanel
          viewer={VIEWER}
          plan={plan}
          promotionEnabled={promotionEnabled}
          price={price}
        />
      </main>
    </DisplayPreferencesProvider>,
    { cachedViewer: VIEWER_QUERY },
  );

const formatted = (iso: string, display: DisplayPreferences) =>
  formatDateTime(new Date(iso), 'longDateTime', display);

const region = () => page.getByRole('region', { name: SECTION_TITLE });
const statusText = (label: string) =>
  page.getByText(`${STATUS_LABEL}: ${label}`, { exact: true });
const subscribeButton = () =>
  page.getByRole('button', { name: SUBSCRIBE_LABEL });
const benefitsHeading = () =>
  page.getByRole('heading', { level: 3, name: BENEFITS_TITLE });
const termTexts = () =>
  Array.from(document.querySelectorAll('dt'), (term) => term.textContent);
const timeOf = (iso: string) =>
  document.querySelector(`time[datetime="${iso}"]`);
const renewalItems = () =>
  page
    .getByRole('list', { name: RENEWAL_TITLE })
    .getByRole('listitem')
    .elements()
    .map((item) => item.textContent);

beforeEach(async () => {
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('PlanStatusPanel', () => {
  test('activeなら、見出し「Ultrasの加入状態」の区画に「加入状態: 有効」と加入中の案内、加入の開始日時と次回の更新日時、特典と条件の一覧を描き、加入のボタンを置かない', async () => {
    await renderPanel({ plan: planOf('ACTIVE') });

    await expect.element(region()).toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 2, name: SECTION_TITLE }))
      .toBeVisible();
    await expect.element(statusText('有効')).toBeVisible();
    await expect
      .element(page.getByText(ACTIVE_GUIDANCE, { exact: true }))
      .toBeVisible();
    expect(termTexts()).toEqual([STARTED_AT_LABEL, RENEWAL_AT_LABEL]);
    expect(timeOf(STARTED_AT)?.textContent).toBe(
      formatted(STARTED_AT, TOKYO_JA),
    );
    expect(timeOf(PERIOD_ENDS_AT)?.textContent).toBe(
      formatted(PERIOD_ENDS_AT, TOKYO_JA),
    );
    await expect.element(benefitsHeading()).toBeVisible();
    expect(renewalItems()[0]).toBe(AUTO_RENEWAL_NOTE_OF_999);
    expect(subscribeButton().query()).toBeNull();
    expect(document.body.textContent).not.toContain(NOT_SUBSCRIBED_MESSAGE);
  });

  test('日時は閲覧者のタイムゾーンとロケールで整形する', async () => {
    await emulateBrowserDisplay(NEW_YORK_EN);

    await renderPanel({ plan: planOf('ACTIVE'), display: NEW_YORK_EN });

    await expect.element(region()).toBeVisible();
    expect(timeOf(STARTED_AT)?.textContent).toBe(
      formatted(STARTED_AT, NEW_YORK_EN),
    );
    expect(formatted(STARTED_AT, NEW_YORK_EN)).not.toBe(
      formatted(STARTED_AT, TOKYO_JA),
    );
  });

  test('past_dueなら、「加入状態: 支払いの再試行中」と支払い方法の更新を促す案内、加入の開始日時と次回の更新日時を描き、特典の一覧と加入のボタンを置かない', async () => {
    await renderPanel({ plan: planOf('PAST_DUE') });

    await expect.element(statusText('支払いの再試行中')).toBeVisible();
    await expect
      .element(page.getByText(PAST_DUE_GUIDANCE, { exact: true }))
      .toBeVisible();
    expect(termTexts()).toEqual([STARTED_AT_LABEL, RENEWAL_AT_LABEL]);
    expect(timeOf(PERIOD_ENDS_AT)).not.toBeNull();
    expect(benefitsHeading().query()).toBeNull();
    expect(subscribeButton().query()).toBeNull();
  });

  test('canceledなら、「加入状態: 解約済み」と取り消しの案内、解約の操作の日時と特典の終了日時を描き、加入のボタンを置かない', async () => {
    await renderPanel({ plan: CANCELED_PLAN });

    await expect.element(statusText('解約済み')).toBeVisible();
    await expect
      .element(page.getByText(CANCELED_GUIDANCE, { exact: true }))
      .toBeVisible();
    expect(termTexts()).toEqual([CANCELED_AT_LABEL, BENEFIT_ENDS_AT_LABEL]);
    expect(timeOf(CANCELED_AT)?.textContent).toBe(
      formatted(CANCELED_AT, TOKYO_JA),
    );
    expect(timeOf(PERIOD_ENDS_AT)?.textContent).toBe(
      formatted(PERIOD_ENDS_AT, TOKYO_JA),
    );
    expect(subscribeButton().query()).toBeNull();
  });

  test('canceledで特典の終了日時が無ければ、その項目を省く', async () => {
    await renderPanel({
      plan: planOf('CANCELED', { canceledAt: CANCELED_AT }),
    });

    await expect.element(statusText('解約済み')).toBeVisible();
    expect(termTexts()).toEqual([CANCELED_AT_LABEL]);
  });

  test('endedで機能フラグがオンなら、「加入状態: 終了」と未加入の旨、月額の価格と加入のボタンを描き、日時の項目を置かない', async () => {
    await renderPanel({ plan: planOf('ENDED'), promotionEnabled: true });

    await expect.element(statusText('終了')).toBeVisible();
    await expect
      .element(page.getByText(NOT_SUBSCRIBED_MESSAGE, { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText('月額$9.99(税込)', { exact: true }))
      .toBeVisible();
    await expect.element(subscribeButton()).toBeEnabled();
    expect(termTexts()).toEqual([]);
    expect(document.querySelector('time')).toBeNull();
    expect(document.body.textContent).not.toContain(PROMOTION_CLOSED_MESSAGE);
  });

  test('加入したことが無く機能フラグがオフなら、未加入の旨に続けて受付停止の旨を描き、加入状態の表示と加入のボタンを置かない', async () => {
    await renderPanel({ plan: null, promotionEnabled: false });

    await expect
      .element(page.getByText(NOT_SUBSCRIBED_MESSAGE, { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText(PROMOTION_CLOSED_MESSAGE, { exact: true }))
      .toBeVisible();
    expect(subscribeButton().query()).toBeNull();
    expect(document.body.textContent).not.toContain(`${STATUS_LABEL}: `);
  });

  test('加入したことが無く機能フラグがオンで価格を照会できなければ、「現在表示できません」を示して加入のボタンを無効にし、その文言を理由として結び付ける', async () => {
    await renderPanel({ plan: null, promotionEnabled: true, price: null });

    await expect
      .element(page.getByText(PRICE_UNAVAILABLE, { exact: true }))
      .toBeVisible();
    await expect.element(subscribeButton()).toBeDisabled();
    await expect
      .element(subscribeButton())
      .toHaveAccessibleDescription(PRICE_UNAVAILABLE);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('加入中の表示で、アクセシビリティの検査の違反が0件', async () => {
      await renderPanel({ plan: planOf('ACTIVE') });
      await expect.element(benefitsHeading()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('解約済みの表示で、アクセシビリティの検査の違反が0件', async () => {
      await renderPanel({ plan: CANCELED_PLAN });
      await expect.element(statusText('解約済み')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('未加入で加入のボタンがある表示で、アクセシビリティの検査の違反が0件', async () => {
      await renderPanel({ plan: null, promotionEnabled: true });
      await expect.element(subscribeButton()).toBeEnabled();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
