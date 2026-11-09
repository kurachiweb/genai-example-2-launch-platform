import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { LaunchPlanView } from '../../graphql/my-products.ts';
import { LaunchPlanNotice } from './launch-plan-notice.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};
const LOS_ANGELES_JA: DisplayPreferences = {
  timeZone: 'America/Los_Angeles',
  locale: 'ja-JP',
};

const NOW = new Date('2026-09-11T03:00:00.000Z');
// 業務日付2026-09-14の0:00(UTC-08:00)
const RELEASE_AT = '2026-09-14T08:00:00.000Z';

const UNKNOWN_MESSAGE = 'ローンチの状態を確認できませんでした。';
const LOCK_MESSAGE =
  'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。';
const HIDDEN_MESSAGE =
  'このプロダクトは公開が停止されているため、ローンチを予約できません。';
const WEEK_BLOCK_MESSAGE =
  'このプロダクトはWeekトーナメントに参加できる期間中のため再ローンチできません。';

const planOf = (overrides: Partial<LaunchPlanView>): LaunchPlanView => ({
  mode: 'new',
  currentLaunchDate: null,
  window: {
    earliest: '2026-09-28',
    latest: '2026-12-09',
    unavailable: [],
    relaunchIntervalDays: null,
  },
  blocks: [],
  locked: false,
  locks: [],
  lockUnknown: false,
  ultrasEntitled: false,
  ...overrides,
});

const RESCHEDULE_PLAN = planOf({
  mode: 'reschedule',
  currentLaunchDate: '2026-09-20',
});
const BLOCKED_PLAN = planOf({
  mode: 'blocked',
  window: null,
  blocks: [
    {
      code: 'tournament-week.entry-open',
      message: WEEK_BLOCK_MESSAGE,
      releaseAt: RELEASE_AT,
    },
    { code: 'product_hidden', message: HIDDEN_MESSAGE, releaseAt: null },
  ],
});
const UNKNOWN_PLAN = planOf({ mode: 'unknown', window: null });
const LOCKED_PLAN = planOf({
  mode: 'blocked',
  window: null,
  blocks: [
    {
      code: 'qualifier_in_progress',
      message: 'このプロダクトは予選マッチに参加中のため再ローンチできません。',
      releaseAt: null,
    },
  ],
  locked: true,
  locks: [{ code: 'qualifier_match', message: LOCK_MESSAGE }],
});

async function renderNotice(
  plan: LaunchPlanView,
  {
    placement = 'list',
    editable,
    display = TOKYO_JA,
  }: {
    readonly placement?: 'list' | 'edit';
    readonly editable?: boolean;
    readonly display?: DisplayPreferences;
  } = {},
) {
  vi.useFakeTimers({
    now: NOW,
    toFake: ['Date', 'setInterval', 'clearInterval'],
  });
  await emulateBrowserDisplay(display);
  return renderInRouter(
    <DisplayPreferencesProvider initial={{ ...display }}>
      <LaunchPlanNotice
        plan={plan}
        productHandle="pitch-notes"
        placement={placement}
        {...(editable === undefined ? {} : { editable })}
      />
    </DisplayPreferencesProvider>,
  );
}

const reserveLink = () =>
  page.getByRole('link', { name: '次回のローンチを予約' });

afterEach(async () => {
  vi.useRealTimers();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('LaunchPlanNotice', () => {
  test('予約できるなら選べる最も早い日を業務日付のまま示し、一覧では編集画面への「次回のローンチを予約」を添える', async () => {
    await renderNotice(planOf({}));

    await expect
      .element(page.getByText(/以降のローンチ日を選べます。$/u))
      .toHaveTextContent('このプロダクトは9月28日以降のローンチ日を選べます。');
    expect(document.querySelector('time')?.dateTime).toBe('2026-09-28');
    await expect
      .element(reserveLink())
      .toHaveAttribute('href', '/my/products/pitch-notes/edit');
  });

  test('選べる最も早い日は利用者のタイムゾーンで日をずらさない', async () => {
    await renderNotice(planOf({}), { display: LOS_ANGELES_JA });

    await expect
      .element(page.getByText(/以降のローンチ日を選べます。$/u))
      .toHaveTextContent('このプロダクトは9月28日以降のローンチ日を選べます。');
  });

  test('選べる最も早い日が今年でなければ年を付ける', async () => {
    await renderNotice(
      planOf({
        window: {
          earliest: '2027-01-04',
          latest: '2027-03-01',
          unavailable: [],
          relaunchIntervalDays: 14,
        },
      }),
    );

    await expect
      .element(page.getByText(/以降のローンチ日を選べます。$/u))
      .toHaveTextContent(
        'このプロダクトは2027年1月4日以降のローンチ日を選べます。',
      );
  });

  test('編集画面ではローンチ日の欄で予約するため「次回のローンチを予約」を出さない', async () => {
    await renderNotice(planOf({}), { placement: 'edit' });

    await expect
      .element(page.getByText(/以降のローンチ日を選べます。$/u))
      .toBeVisible();
    expect(reserveLink().query()).toBeNull();
  });

  test('変更できない利用者には、一覧でも「次回のローンチを予約」を出さず、選べる最も早い日だけを示す', async () => {
    await renderNotice(planOf({}), { editable: false });

    await expect
      .element(page.getByText(/以降のローンチ日を選べます。$/u))
      .toBeVisible();
    expect(reserveLink().query()).toBeNull();
  });

  test('予定のローンチがあれば、ローンチ日を編集画面で変更できる旨を示す', async () => {
    await renderNotice(RESCHEDULE_PLAN);

    await expect
      .element(page.getByText('ローンチ日は編集画面で変更できます。'))
      .toBeVisible();
    expect(reserveLink().query()).toBeNull();
  });

  test('予約できないなら理由の文言をすべて示し、解除の日時があれば利用者のタイムゾーンのtime要素で相対表現とともに示す', async () => {
    await renderNotice(BLOCKED_PLAN);

    await expect.element(page.getByText(WEEK_BLOCK_MESSAGE)).toBeVisible();
    await expect.element(page.getByText(HIDDEN_MESSAGE)).toBeVisible();
    const releases = page.getByText(/^解除: /u).elements();
    expect(releases).toHaveLength(1);
    expect(releases[0]?.textContent).toBe('解除: 9月14日(月) 17:00(あと3日)');
    expect(document.querySelector('time')?.dateTime).toBe(RELEASE_AT);
    expect(reserveLink().query()).toBeNull();
  });

  test('判定に失敗したなら、ローンチの状態を確認できなかった旨を示す', async () => {
    await renderNotice(UNKNOWN_PLAN);

    await expect.element(page.getByText(UNKNOWN_MESSAGE)).toBeVisible();
    expect(reserveLink().query()).toBeNull();
  });

  test('固定の期間は、予約の可否の案内に加えて固定の理由を示す', async () => {
    await renderNotice(LOCKED_PLAN);

    await expect
      .element(
        page.getByText(
          'このプロダクトは予選マッチに参加中のため再ローンチできません。',
        ),
      )
      .toBeVisible();
    await expect.element(page.getByText(LOCK_MESSAGE)).toBeVisible();
  });

  test('固定の判定に失敗したなら、予約の可否の案内に加えて確認できなかった旨を示す', async () => {
    await renderNotice(planOf({ mode: 'reschedule', lockUnknown: true }));

    await expect
      .element(page.getByText('ローンチ日は編集画面で変更できます。'))
      .toBeVisible();
    await expect.element(page.getByText(UNKNOWN_MESSAGE)).toBeVisible();
  });

  test('予約の判定と固定の判定の両方に失敗しても、確認できなかった旨は1度だけ示す', async () => {
    await renderNotice(planOf({ mode: 'unknown', lockUnknown: true }));

    await expect.element(page.getByText(UNKNOWN_MESSAGE)).toBeVisible();
    expect(page.getByText(UNKNOWN_MESSAGE).elements()).toHaveLength(1);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each([
    ['予約できる', planOf({})],
    ['変更できる', RESCHEDULE_PLAN],
    ['予約できない', BLOCKED_PLAN],
    ['判定に失敗した', UNKNOWN_PLAN],
    ['固定の期間', LOCKED_PLAN],
  ] as const)(
    '%s案内のアクセシビリティの検査の違反が0件',
    async (_label, plan) => {
      applyColorScheme(scheme);

      await renderNotice(plan);

      await expect.poll(() => document.body.textContent).not.toBe('');
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
