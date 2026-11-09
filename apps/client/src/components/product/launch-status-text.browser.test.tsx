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
import type { ProductLaunchView } from '../../graphql/product-launch.ts';
import { LaunchStatusText } from './launch-status-text.tsx';

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
const BUSINESS_TIME_JA: DisplayPreferences = {
  timeZone: 'Etc/GMT+8',
  locale: 'ja-JP',
};

// 業務日付2026-09-15の0:00(UTC-08:00)
const KICKOFF_ISO = '2026-09-15T08:00:00.000Z';
const KICKOFF = new Date(KICKOFF_ISO);
const DAY_MS = 24 * 60 * 60 * 1000;

const launchOf = (
  overrides: Partial<ProductLaunchView>,
): ProductLaunchView => ({
  id: 'launch-1',
  number: 1,
  launchDate: '2026-09-15',
  kickoffAt: KICKOFF_ISO,
  status: 'scheduled',
  outcome: null,
  summary: { label: 'キックオフ予定', inMatch: false },
  ...overrides,
});

const useClockAt = (now: Date): void => {
  vi.useFakeTimers({ now, toFake: ['Date', 'setInterval', 'clearInterval'] });
};

async function renderStatus(
  launch: ProductLaunchView,
  display: DisplayPreferences = TOKYO_JA,
) {
  await emulateBrowserDisplay(display);
  return renderInRouter(
    <DisplayPreferencesProvider initial={{ ...display }}>
      <LaunchStatusText launch={launch} />
    </DisplayPreferencesProvider>,
  );
}

const timeElements = (): HTMLTimeElement[] => [
  ...document.querySelectorAll('time'),
];

afterEach(async () => {
  vi.useRealTimers();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('LaunchStatusText', () => {
  test.each(['scheduled', 'paired'] as const)(
    '%sは「キックオフ予定」と、キックオフの日時を利用者のタイムゾーンのtime要素で相対表現とともに示す',
    async (status) => {
      useClockAt(new Date(KICKOFF.getTime() - 2 * DAY_MS - 60 * 1000));

      await renderStatus(launchOf({ status }));

      await expect.element(page.getByText('キックオフ予定')).toBeVisible();
      await expect
        .element(page.getByText(/^キックオフ: /u))
        .toHaveTextContent('キックオフ: 9月15日(火) 17:00(あと2日)');
      const [time] = timeElements();
      expect(time?.dateTime).toBe(KICKOFF_ISO);
    },
  );

  test('キックオフの日時は利用者のタイムゾーンで示し、基準時刻の利用者には基準時刻の0時で示す', async () => {
    useClockAt(new Date(KICKOFF.getTime() - 5 * DAY_MS));

    await renderStatus(launchOf({}), BUSINESS_TIME_JA);

    await expect
      .element(page.getByText(/^キックオフ: /u))
      .toHaveTextContent('キックオフ: 9月15日(火) 00:00(あと5日)');
  });

  test('今年でないキックオフは年を付けて示す', async () => {
    useClockAt(new Date('2026-11-09T03:00:00.000Z'));

    await renderStatus(
      launchOf({
        launchDate: '2027-01-08',
        kickoffAt: '2027-01-08T08:00:00.000Z',
      }),
    );

    await expect
      .element(page.getByText(/^キックオフ: /u))
      .toHaveTextContent('キックオフ: 2027年1月8日(金) 17:00(あと約2か月)');
  });

  test('マッチ中は「予選マッチ中」と、トップページへの「トップページで見る」を示す', async () => {
    useClockAt(new Date(KICKOFF.getTime() + 60 * 60 * 1000));

    await renderStatus(launchOf({ status: 'in_progress' }));

    await expect.element(page.getByText('予選マッチ中')).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'トップページで見る' }))
      .toHaveAttribute('href', '/');
    expect(timeElements()).toHaveLength(0);
  });

  test.each([
    ['won', 'ディレクトリ掲載'],
    ['lost', '予選敗北'],
  ] as const)(
    '終了して%sなら「%s」とローンチ日を示す',
    async (outcome, label) => {
      useClockAt(new Date('2026-09-20T03:00:00.000Z'));

      await renderStatus(launchOf({ status: 'finished', outcome }));

      await expect.element(page.getByText(label)).toBeVisible();
      await expect
        .element(page.getByText(/^ローンチ日: /u))
        .toHaveTextContent('ローンチ日: 9月15日');
      expect(page.getByText('キックオフ予定').query()).toBeNull();
      expect(
        page.getByRole('link', { name: 'トップページで見る' }).query(),
      ).toBeNull();
    },
  );

  test.each([TOKYO_JA, LOS_ANGELES_JA])(
    '終了したローンチのローンチ日は業務日付のままtime要素で示し、$timeZoneの利用者にも日をずらさない',
    async (display) => {
      useClockAt(new Date('2026-09-20T03:00:00.000Z'));

      await renderStatus(
        launchOf({ status: 'finished', outcome: 'won' }),
        display,
      );

      await expect
        .element(page.getByText(/^ローンチ日: /u))
        .toHaveTextContent('ローンチ日: 9月15日');
      const [time] = timeElements();
      expect(time?.dateTime).toBe('2026-09-15');
    },
  );

  test('今年でないローンチ日は年を付けて示す', async () => {
    useClockAt(new Date('2027-02-01T03:00:00.000Z'));

    await renderStatus(launchOf({ status: 'finished', outcome: 'lost' }));

    await expect
      .element(page.getByText(/^ローンチ日: /u))
      .toHaveTextContent('ローンチ日: 2026年9月15日');
  });

  test('取消は「取消」だけを示す', async () => {
    useClockAt(new Date('2026-09-10T03:00:00.000Z'));

    await renderStatus(launchOf({ status: 'canceled', number: 0 }));

    await expect.element(page.getByText('取消')).toBeVisible();
    expect(page.getByText('キックオフ予定').query()).toBeNull();
    expect(timeElements()).toHaveLength(0);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each([
    launchOf({}),
    launchOf({ status: 'in_progress' }),
    launchOf({ status: 'finished', outcome: 'won' }),
    launchOf({ status: 'canceled', number: 0 }),
  ])('状態$statusの表示のアクセシビリティの検査の違反が0件', async (launch) => {
    applyColorScheme(scheme);
    useClockAt(new Date(KICKOFF.getTime() - DAY_MS));

    await renderStatus(launch);

    await expect.poll(() => document.body.textContent).not.toBe('');
    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
