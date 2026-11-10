import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { AutoRefreshSwitch } from './auto-refresh-switch.tsx';

const DESCRIPTION =
  'オンの間は30秒ごとにUpvote数を取り直し、残り時間と演出を動かします。';

const autoRefreshSwitch = () => page.getByRole('switch', { name: '自動更新' });

afterEach(() => {
  applyColorScheme('light');
});

describe('AutoRefreshSwitch', () => {
  test.each([
    [true, 'true'],
    [false, 'false'],
  ])(
    '名前「自動更新」のスイッチに定期の取り直しの間隔の説明を関連付け、状態(%s)をaria-checkedで示す',
    async (checked, ariaChecked) => {
      await render(
        <AutoRefreshSwitch
          checked={checked}
          onCheckedChange={() => undefined}
        />,
      );

      await expect
        .element(autoRefreshSwitch())
        .toHaveAttribute('aria-checked', ariaChecked);
      await expect
        .element(autoRefreshSwitch())
        .toHaveAccessibleDescription(DESCRIPTION);
    },
  );

  test('押すかSpaceキーで、切り替えた後の状態を呼び出す側へ伝える', async () => {
    const onCheckedChange = vi.fn();
    await render(
      <AutoRefreshSwitch checked onCheckedChange={onCheckedChange} />,
    );

    await userEvent.click(autoRefreshSwitch());
    await userEvent.keyboard(' ');

    expect(onCheckedChange.mock.calls).toEqual([[false], [false]]);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([true, false])(
      'オン(%s)とオフで、アクセシビリティの検査の違反が0件',
      async (checked) => {
        applyColorScheme(scheme);
        const { container } = await render(
          <div className="bg-background p-4 text-foreground">
            <AutoRefreshSwitch
              checked={checked}
              onCheckedChange={() => undefined}
            />
          </div>,
        );

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});
