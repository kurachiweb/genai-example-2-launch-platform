import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  tokenColorOf,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { EntryDeadline, type EntryDeadlineProps } from './entry-deadline.tsx';
import {
  SERVER_TIME_48_HOURS_BEFORE,
  SERVER_TIME_THREE_DAYS_BEFORE,
  serverTimeBeforeAcceptUntil,
  WEEK_ENTRY_ACCEPT_UNTIL,
} from './week-entry-fixtures.ts';

const LOS_ANGELES_JA: DisplayPreferences = {
  timeZone: 'America/Los_Angeles',
  locale: 'ja-JP',
};

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

// 閲覧者の時計はサーバーより5分遅れている
const CLIENT_LAG_MS = 5 * MINUTE_MS;

const JUST_UNDER_48_HOURS = serverTimeBeforeAcceptUntil(
  48 * HOUR_MS - SECOND_MS,
);

const startClientClockAt = (serverTime: string): void => {
  vi.useFakeTimers({
    now: new Date(new Date(serverTime).getTime() - CLIENT_LAG_MS),
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  });
};

const propsOf = (
  overrides: Partial<EntryDeadlineProps> = {},
): EntryDeadlineProps => ({
  acceptUntil: WEEK_ENTRY_ACCEPT_UNTIL,
  serverTime: SERVER_TIME_THREE_DAYS_BEFORE,
  autoRefresh: true,
  ...overrides,
});

async function renderDeadline(props: EntryDeadlineProps) {
  startClientClockAt(props.serverTime);
  await emulateBrowserDisplay(LOS_ANGELES_JA);
  return render(
    <DisplayPreferencesProvider initial={{ ...LOS_ANGELES_JA }}>
      <EntryDeadline {...props} />
    </DisplayPreferencesProvider>,
  );
}

const timer = () => page.getByRole('timer', { name: '決済期限までの残り時間' });

const deadlineTime = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>(
    '[data-entry-deadline-time]',
  );
  if (element === null) {
    throw new Error('決済期限の日時がありません。');
  }
  return element;
};

const digitsOf = (): string | null =>
  document.querySelector('[data-countdown-digits]')?.textContent ?? null;

const readingOf = (): string | null =>
  document.querySelector('[data-countdown-reading]')?.textContent ?? null;

afterEach(async () => {
  vi.useRealTimers();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('EntryDeadline', () => {
  test('項目「決済期限」と、受付期限の23:00を閲覧者のタイムゾーンの日時とtime要素と相対表現で示す', async () => {
    await renderDeadline(propsOf());

    await expect.element(page.getByText('決済期限')).toBeVisible();
    const time = deadlineTime().querySelector('time');
    expect(time?.dateTime).toBe(WEEK_ENTRY_ACCEPT_UNTIL);
    expect(time?.textContent).toBe('11月23日(月) 23:00');
    expect(deadlineTime().textContent).toBe('11月23日(月) 23:00(あと3日)');
  });

  test('受付期限まで48時間ちょうどは、注意色にせず秒読みを出さない', async () => {
    await renderDeadline(propsOf({ serverTime: SERVER_TIME_48_HOURS_BEFORE }));

    await expect.element(page.getByText('決済期限')).toBeVisible();
    expect(timer().query()).toBeNull();
    expect(getComputedStyle(deadlineTime()).color).not.toBe(
      tokenColorOf('warning-strong'),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  test('受付期限まで48時間未満は、注意色で強調し「締め切りまであと」と時:分:秒の秒読みを添える', async () => {
    await renderDeadline(propsOf({ serverTime: JUST_UNDER_48_HOURS }));

    await expect.element(timer()).toBeVisible();
    expect(getComputedStyle(deadlineTime()).color).toBe(
      tokenColorOf('warning-strong'),
    );
    await expect
      .element(timer().getByText('締め切りまであと', { exact: true }))
      .toBeVisible();
    expect(digitsOf()).toBe('47:59:59');
    expect(readingOf()).toBe('締め切りまであと47時間59分');
  });

  test('秒読みは閲覧者の時計のずれを補正して1秒ごとに進み、数字とラベルは読ませず分単位の文言を通知しない領域で持つ', async () => {
    await renderDeadline(
      propsOf({ serverTime: serverTimeBeforeAcceptUntil(12 * MINUTE_MS) }),
    );

    expect(digitsOf()).toBe('00:12:00');
    await vi.advanceTimersByTimeAsync(SECOND_MS);
    expect(digitsOf()).toBe('00:11:59');
    expect(readingOf()).toBe('締め切りまであと11分');

    const digits = document.querySelector('[data-countdown-digits]');
    expect(digits?.closest('[aria-hidden="true"]')).not.toBeNull();
    const label = page.getByText('締め切りまであと', { exact: true });
    expect(label.element().closest('[aria-hidden="true"]')).not.toBeNull();
    const reading = document.querySelector('[data-countdown-reading]');
    expect(reading?.getAttribute('aria-live')).toBe('off');
  });

  test('受付期限を過ぎると00:00:00で止まる', async () => {
    await renderDeadline(
      propsOf({ serverTime: serverTimeBeforeAcceptUntil(2 * SECOND_MS) }),
    );

    await vi.advanceTimersByTimeAsync(5 * SECOND_MS);

    expect(digitsOf()).toBe('00:00:00');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('自動更新がオフの間は、注意色を保ったまま秒読みを出さず毎秒の更新を止める', async () => {
    await renderDeadline(
      propsOf({ serverTime: JUST_UNDER_48_HOURS, autoRefresh: false }),
    );

    await expect.element(page.getByText('決済期限')).toBeVisible();
    expect(timer().query()).toBeNull();
    expect(digitsOf()).toBeNull();
    expect(readingOf()).toBeNull();
    expect(getComputedStyle(deadlineTime()).color).toBe(
      tokenColorOf('warning-strong'),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(COLOR_SCHEMES)(
    '秒読みを出した状態で自動検査の違反が無い(%s)',
    async (scheme) => {
      applyColorScheme(scheme);
      const screen = await renderDeadline(
        propsOf({ serverTime: JUST_UNDER_48_HOURS }),
      );

      await expect.element(timer()).toBeVisible();
      // axe-coreは検査の途中でsetTimeoutを待つため、偽のタイマーを戻してから検査する
      vi.useRealTimers();
      expect(await runAxe(screen.container)).toStrictEqual([]);
    },
  );
});
