import type { ReactElement } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { emulateBrowserDisplay } from '../../test/display-emulation.ts';
import type { DisplayPreferences } from '../../utilities/datetime/display-preferences.ts';
import { DisplayPreferencesProvider } from '../datetime/display-preferences-provider.tsx';
import { MoneyText } from './money-text.tsx';

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};
const NEW_YORK_EN: DisplayPreferences = {
  timeZone: 'America/New_York',
  locale: 'en-US',
};
const BERLIN_DE: DisplayPreferences = {
  timeZone: 'Europe/Berlin',
  locale: 'de-DE',
};

const NBSP = '\u00A0';

async function renderWithBrowserDisplay(
  ui: ReactElement,
  preferences: DisplayPreferences,
) {
  await emulateBrowserDisplay(preferences);
  return render(
    <DisplayPreferencesProvider initial={{ ...preferences }}>
      {ui}
    </DisplayPreferencesProvider>,
  );
}

afterEach(async () => {
  await emulateBrowserDisplay(null);
});

describe('MoneyText', () => {
  test.each([
    [TOKYO_JA, '$1,234,567.89'],
    [NEW_YORK_EN, '$1,234,567.89'],
    [BERLIN_DE, `1.234.567,89${NBSP}$`],
  ])(
    '%oのロケールに従い、最小通貨単位の整数をドルに直したUSDで表示する',
    async (preferences, expected) => {
      const { container } = await renderWithBrowserDisplay(
        <MoneyText amount={123_456_789} />,
        preferences,
      );

      expect(container.textContent).toBe(expected);
    },
  );

  test.each([
    [5, '$0.05'],
    [0, '$0.00'],
    [1500, '$15.00'],
  ])('%dセントを小数点以下2桁のドルで表示する', async (amount, expected) => {
    const { container } = await renderWithBrowserDisplay(
      <MoneyText amount={amount} />,
      NEW_YORK_EN,
    );

    expect(container.textContent).toBe(expected);
  });

  test.each([
    [NEW_YORK_EN, '-$15.00'],
    [BERLIN_DE, `-15,00${NBSP}$`],
  ])(
    '%oのロケールで負の金額に負の符号を付ける',
    async (preferences, expected) => {
      const { container } = await renderWithBrowserDisplay(
        <MoneyText amount={-1500} />,
        preferences,
      );

      expect(container.textContent).toBe(expected);
    },
  );

  test('符号の指定が無ければ、正の金額に正の符号を付けない', async () => {
    const { container } = await renderWithBrowserDisplay(
      <MoneyText amount={1500} />,
      NEW_YORK_EN,
    );

    expect(container.textContent).toBe('$15.00');
  });

  test.each([
    [1500, '+$15.00'],
    [-1500, '-$15.00'],
    [0, '$0.00'],
  ])(
    '符号付きの指定では、%dセントを0以外の符号付きで表示する',
    async (amount, expected) => {
      const { container } = await renderWithBrowserDisplay(
        <MoneyText amount={amount} signDisplay="exceptZero" />,
        NEW_YORK_EN,
      );

      expect(container.textContent).toBe(expected);
    },
  );

  test('アクセシビリティの違反が無い', async () => {
    const { container } = await renderWithBrowserDisplay(
      <p>
        価格(税込)
        <MoneyText amount={1500} />
        、返金
        <MoneyText amount={-500} signDisplay="exceptZero" />
      </p>,
      TOKYO_JA,
    );

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
