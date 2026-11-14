import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import {
  FullTimeCountdown,
  type FullTimeCountdownProps,
} from './full-time-countdown.tsx';

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};
const LOS_ANGELES_JA: DisplayPreferences = {
  timeZone: 'America/Los_Angeles',
  locale: 'ja-JP',
};

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

// 業務日付2026-11-10の23:40(UTC-08:00)
const FULL_TIME_AT = '2026-11-11T07:40:00.000Z';
const FULL_TIME = new Date(FULL_TIME_AT).getTime();
// 閲覧者の時計はサーバーより5分遅れている
const CLIENT_LAG_MS = 5 * MINUTE_MS;

const serverTimeBefore = (remainingMs: number): string =>
  new Date(FULL_TIME - remainingMs).toISOString();

const useClientClockAt = (serverTime: string): void => {
  vi.useFakeTimers({
    now: new Date(new Date(serverTime).getTime() - CLIENT_LAG_MS),
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  });
};

const REMAINING_12_34_56 = 12 * HOUR_MS + 34 * MINUTE_MS + 56 * SECOND_MS;

const propsOf = (
  overrides: Partial<FullTimeCountdownProps> = {},
): FullTimeCountdownProps => ({
  phase: 'LIVE',
  fullTimeAt: FULL_TIME_AT,
  serverTime: serverTimeBefore(REMAINING_12_34_56),
  autoRefresh: true,
  ...overrides,
});

const elementOf = (props: FullTimeCountdownProps) => (
  <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
    <FullTimeCountdown {...props} />
  </DisplayPreferencesProvider>
);

async function renderCountdown(
  props: FullTimeCountdownProps,
  display: DisplayPreferences = TOKYO_JA,
) {
  await emulateBrowserDisplay(display);
  return render(elementOf(props));
}

const regionOf = (): HTMLElement | null =>
  document.querySelector('section[aria-label="フルタイムまでの残り時間"]');

const digitsOf = (): string | null =>
  document.querySelector('[data-countdown-digits]')?.textContent ?? null;

const readingOf = (): string | null =>
  document.querySelector('[data-countdown-reading]')?.textContent ?? null;

const timeElements = (): HTMLTimeElement[] => [
  ...document.querySelectorAll('time'),
];

const twoDigits = (value: number): string => String(value).padStart(2, '0');

// 終了の時刻までの残りを、表示と同じ時:分:秒の形にする(秒の端数の無い残りだけを渡す)
const digitsAt = (remainingMs: number): string =>
  [
    Math.floor(remainingMs / HOUR_MS),
    Math.floor((remainingMs % HOUR_MS) / MINUTE_MS),
    Math.floor((remainingMs % MINUTE_MS) / SECOND_MS),
  ]
    .map(twoDigits)
    .join(':');

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const actEnvironment = globalThis as ActEnvironment;
const hydratedRoots: Root[] = [];

// vitest-browser-reactのrenderは自分のactの後にactの環境の指定を戻すため、Reactのactを直接呼ぶたびに指定し直す
async function actInTestEnvironment(
  callback: () => Promise<void>,
): Promise<void> {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(callback);
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  }
}

afterEach(async () => {
  await actInTestEnvironment(async () => {
    for (const root of hydratedRoots.splice(0)) {
      root.unmount();
    }
    await Promise.resolve();
  });
  vi.useRealTimers();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('FullTimeCountdown', () => {
  test('閲覧者の時計がずれていても、取得時のサーバーの時刻との差で補正した残り時間を時:分:秒で出す', async () => {
    const props = propsOf();
    useClientClockAt(props.serverTime);
    await renderCountdown(props);

    await expect
      .element(page.getByRole('region', { name: 'フルタイムまでの残り時間' }))
      .toBeVisible();
    expect(digitsOf()).toBe('12:34:56');
    expect(readingOf()).toBe('フルタイムまであと12時間34分');
  });

  test('1秒ごとに残り時間を進め、読み上げの文言は分が変わった時だけ変わる', async () => {
    const props = propsOf();
    useClientClockAt(props.serverTime);
    await renderCountdown(props);

    await vi.advanceTimersByTimeAsync(SECOND_MS);
    expect(digitsOf()).toBe('12:34:55');
    expect(readingOf()).toBe('フルタイムまであと12時間34分');

    await vi.advanceTimersByTimeAsync(55 * SECOND_MS);
    expect(digitsOf()).toBe('12:34:00');
    expect(readingOf()).toBe('フルタイムまであと12時間34分');

    await vi.advanceTimersByTimeAsync(SECOND_MS);
    expect(digitsOf()).toBe('12:33:59');
    expect(readingOf()).toBe('フルタイムまであと12時間33分');
  });

  test('時:分:秒の数字と見えるラベルは支援技術に読ませず、ラベルを含む分単位の文言を通知しない領域で持つ', async () => {
    const props = propsOf();
    useClientClockAt(props.serverTime);
    await renderCountdown(props);

    const digits = document.querySelector('[data-countdown-digits]');
    expect(digits?.closest('[aria-hidden="true"]')).not.toBeNull();
    const reading = document.querySelector('[data-countdown-reading]');
    expect(reading?.getAttribute('aria-live')).toBe('off');
    const label = page.getByText('フルタイムまであと', { exact: true });
    expect(label.element().closest('[aria-hidden="true"]')).not.toBeNull();
    expect(regionOf()?.textContent).toContain('(16:40終了)');
  });

  test.each([
    [34 * MINUTE_MS + 12 * SECOND_MS, '00:34:12', 'フルタイムまであと34分'],
    [42 * SECOND_MS, '00:00:42', 'フルタイムまであと1分未満'],
  ])(
    '残り%iミリ秒は「%s」と「%s」にする',
    async (remainingMs, digits, reading) => {
      const props = propsOf({ serverTime: serverTimeBefore(remainingMs) });
      useClientClockAt(props.serverTime);
      await renderCountdown(props);

      expect(digitsOf()).toBe(digits);
      expect(readingOf()).toBe(reading);
    },
  );

  test('0になった後は00:00:00で止まり、取り直しは持たない', async () => {
    const props = propsOf({ serverTime: serverTimeBefore(2 * SECOND_MS) });
    useClientClockAt(props.serverTime);
    await renderCountdown(props);

    await vi.advanceTimersByTimeAsync(5 * SECOND_MS);

    expect(digitsOf()).toBe('00:00:00');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('終了の時刻をtime要素で、閲覧者のタイムゾーンの時刻で示す', async () => {
    const props = propsOf();
    useClientClockAt(props.serverTime);
    await renderCountdown(props, LOS_ANGELES_JA);

    const [time] = timeElements();
    expect(timeElements()).toHaveLength(1);
    expect(time?.dateTime).toBe(FULL_TIME_AT);
    expect(time?.textContent).toBe('23:40');
    expect(regionOf()?.textContent).toContain('(23:40終了)');
  });

  test('結果の時間帯(RESULT)では何も出さない', async () => {
    const props = propsOf({ phase: 'RESULT' });
    useClientClockAt(props.serverTime);
    const { container } = await renderCountdown(props);

    expect(regionOf()).toBeNull();
    expect(container.textContent).toBe('');
  });

  test('自動更新がオフの間はラベル・時:分:秒・読み上げの文言を出さず、終了の時刻だけを残して毎秒の更新を止める', async () => {
    const props = propsOf({ autoRefresh: false });
    useClientClockAt(props.serverTime);
    await renderCountdown(props);

    expect(digitsOf()).toBeNull();
    expect(readingOf()).toBeNull();
    expect(regionOf()?.querySelector('svg')).toBeNull();
    expect(regionOf()?.textContent).toBe('(16:40終了)');
    expect(timeElements()[0]?.dateTime).toBe(FULL_TIME_AT);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('自動更新がオフのまま時間が経ってからオンにすると、マウント時のサーバーの時刻との差で補正したその時点の残り時間を出す', async () => {
    const props = propsOf({ autoRefresh: false });
    useClientClockAt(props.serverTime);
    const screen = await renderCountdown(props);

    await vi.advanceTimersByTimeAsync(60 * SECOND_MS);
    await screen.rerender(elementOf({ ...props, autoRefresh: true }));

    expect(digitsOf()).toBe('12:33:56');
    expect(readingOf()).toBe('フルタイムまであと12時間33分');
  });

  test('自動更新がオフの間の取り直しでサーバーの時刻が変わると、オンに戻した時点ではなく取り直した時点の差で補正する', async () => {
    const props = propsOf();
    useClientClockAt(props.serverTime);
    const screen = await renderCountdown(props);
    await screen.rerender(elementOf({ ...props, autoRefresh: false }));

    // オフのままの取り直しで、サーバーは閲覧者の時計より10分進んだ時刻を返す
    const serverTime = new Date(Date.now() + 10 * MINUTE_MS).toISOString();
    await screen.rerender(
      elementOf({ ...props, serverTime, autoRefresh: false }),
    );
    await vi.advanceTimersByTimeAsync(60 * SECOND_MS);
    await screen.rerender(elementOf({ ...props, serverTime }));

    expect(digitsOf()).toBe(
      digitsAt(FULL_TIME - new Date(serverTime).getTime() - 60 * SECOND_MS),
    );
  });

  test('自動更新をオフにすると止まり、オンに戻すとその時点の残り時間から再び動く', async () => {
    const props = propsOf();
    useClientClockAt(props.serverTime);
    const screen = await renderCountdown(props);

    await screen.rerender(elementOf({ ...props, autoRefresh: false }));
    expect(digitsOf()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(10 * SECOND_MS);
    await screen.rerender(elementOf(props));
    expect(digitsOf()).toBe('12:34:46');
    expect(readingOf()).toBe('フルタイムまであと12時間34分');

    await vi.advanceTimersByTimeAsync(SECOND_MS);
    expect(digitsOf()).toBe('12:34:45');
  });

  test('取り直しでサーバーの時刻が変わると、その時点の時計の差で補正し直す', async () => {
    const props = propsOf();
    useClientClockAt(props.serverTime);
    const screen = await renderCountdown(props);

    // 30秒後の取り直しで、サーバーは閲覧者の時計より10分進んだ時刻を返す
    await vi.advanceTimersByTimeAsync(30 * SECOND_MS);
    const serverTime = new Date(Date.now() + 10 * MINUTE_MS).toISOString();
    await screen.rerender(elementOf({ ...props, serverTime }));

    expect(digitsOf()).toBe(
      digitsAt(FULL_TIME - new Date(serverTime).getTime()),
    );
  });

  test('サーバー側の描画では残り時間を計算せず、仮の表示と終了の時刻を出す', async () => {
    await emulateBrowserDisplay(TOKYO_JA);

    const html = renderToString(elementOf(propsOf()));

    expect(html).toContain('--:--:--');
    expect(html).toContain(`dateTime="${FULL_TIME_AT}"`);
    expect(html).not.toContain('フルタイムまであと12時間');
  });

  test('サーバー側の描画をハイドレーションしても食い違いのエラーを出さず、ハイドレーションの後に残り時間を出す', async () => {
    await emulateBrowserDisplay(TOKYO_JA);
    const ui = elementOf(propsOf({ serverTime: new Date().toISOString() }));
    const container = document.body.appendChild(document.createElement('div'));
    container.replaceChildren(
      ...new DOMParser().parseFromString(renderToString(ui), 'text/html').body
        .childNodes,
    );
    const recoverableErrors: unknown[] = [];

    await actInTestEnvironment(async () => {
      hydratedRoots.push(
        hydrateRoot(container, ui, {
          onRecoverableError: (error) => {
            recoverableErrors.push(error);
          },
        }),
      );
      await Promise.resolve();
    });

    expect(recoverableErrors).toStrictEqual([]);
    expect(
      container.querySelector('[data-countdown-digits]')?.textContent,
    ).toMatch(/^\d{2}:\d{2}:\d{2}$/u);
    container.remove();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each([true, false])(
    '自動更新が%sでアクセシビリティの検査の違反が0件',
    async (autoRefresh) => {
      applyColorScheme(scheme);
      const { container } = await renderCountdown(propsOf({ autoRefresh }));

      await expect
        .element(page.getByRole('region', { name: 'フルタイムまでの残り時間' }))
        .toBeVisible();
      expect(await runAxe(container)).toStrictEqual([]);
    },
  );
});
