import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
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
import { SponsorshipPeriodText } from './sponsorship-period-text.tsx';

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

// 東京の2026年11月18日の正午
const NOW = new Date('2026-11-18T03:00:00.000Z');

// 表示設定はブラウザのタイムゾーンへ合わせ直されるため、ブラウザの表示も東京にそろえる
async function renderPeriod(startsOn: string, endsOn: string) {
  await emulateBrowserDisplay(TOKYO_JA);
  return render(
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <p>
        <SponsorshipPeriodText startsOn={startsOn} endsOn={endsOn} />
      </p>
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

describe('SponsorshipPeriodText', () => {
  test.each<[string, string, string, string, readonly string[]]>([
    [
      '今年の期間は月日だけで示す',
      '2026-11-20',
      '2026-12-03',
      '11月20日〜12月3日、14日間',
      ['11月20日', '12月3日'],
    ],
    [
      '今年でない日付だけに年を付ける',
      '2026-12-30',
      '2027-01-02',
      '12月30日〜2027年1月2日、4日間',
      ['12月30日', '2027年1月2日'],
    ],
    [
      '前の年に始まった期間は開始日に年を付ける',
      '2025-12-31',
      '2026-01-01',
      '2025年12月31日〜1月1日、2日間',
      ['2025年12月31日', '1月1日'],
    ],
    [
      '1日の期間は同じ日を2つ示す',
      '2026-11-18',
      '2026-11-18',
      '11月18日〜11月18日、1日間',
      ['11月18日', '11月18日'],
    ],
  ])('%s', async (_label, startsOn, endsOn, expectedText, expectedLabels) => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });

    const { container } = await renderPeriod(startsOn, endsOn);

    await expect.element(page.getByText(/日間$/u)).toBeVisible();
    expect(container.textContent).toBe(expectedText);
    expect(timeElements().map((element) => element.textContent)).toEqual(
      expectedLabels,
    );
  });

  test('開始日と終了日を業務日付のままdateTimeに持つtime要素で示し、日時に変えない', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });

    await renderPeriod('2026-12-30', '2027-01-02');

    await expect.element(page.getByText('4日間')).toBeVisible();
    expect(timeElements().map((element) => element.dateTime)).toEqual([
      '2026-12-30',
      '2027-01-02',
    ]);
  });

  test('閲覧者のタイムゾーンで日をずらさない', async () => {
    // 東京では2027年1月1日になる時点でも、業務日付の年と暦日のまま示す
    vi.useFakeTimers({
      now: new Date('2026-12-31T16:00:00.000Z'),
      toFake: ['Date'],
    });

    await renderPeriod('2026-12-31', '2027-01-01');

    await expect.element(page.getByText('2日間')).toBeVisible();
    expect(timeElements().map((element) => element.textContent)).toEqual([
      '2026年12月31日',
      '1月1日',
    ]);
  });

  test.each(COLOR_SCHEMES)('%sの配色でaxeの違反が0件である', async (scheme) => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    applyColorScheme(scheme);

    const { container } = await renderPeriod('2026-12-30', '2027-01-02');

    await expect.element(page.getByText('4日間')).toBeVisible();
    expect(await runAxe(container)).toStrictEqual([]);
  });
});
