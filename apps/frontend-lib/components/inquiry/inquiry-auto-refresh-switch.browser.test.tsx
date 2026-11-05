import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { InquiryAutoRefreshSwitch } from './inquiry-auto-refresh-switch.tsx';

const autoRefreshSwitch = () => page.getByRole('switch', { name: '自動更新' });

afterEach(() => {
  applyColorScheme('light');
});

describe('InquiryAutoRefreshSwitch', () => {
  test('名前「自動更新」のスイッチに、30秒ごとに取り直す旨の説明を関連付けて現在の状態を示す', async () => {
    await render(
      <InquiryAutoRefreshSwitch checked onCheckedChange={() => undefined} />,
    );

    await expect.element(autoRefreshSwitch()).toBeChecked();
    await expect
      .element(autoRefreshSwitch())
      .toHaveAccessibleDescription(
        'オンの間は30秒ごとに新しいメッセージと対応ステータスを表示します。',
      );
  });

  test('押すかSpaceキーで、切り替えた後の状態を呼び出す側へ伝える', async () => {
    const onCheckedChange = vi.fn();
    await render(
      <InquiryAutoRefreshSwitch
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );
    await expect.element(autoRefreshSwitch()).not.toBeChecked();

    await userEvent.click(autoRefreshSwitch());
    await userEvent.keyboard(' ');

    expect(onCheckedChange.mock.calls).toEqual([[true], [true]]);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([true, false])(
      'オン(%s)とオフで、アクセシビリティの検査の違反が0件',
      async (checked) => {
        applyColorScheme(scheme);
        const { container } = await render(
          <div className="bg-background p-4 text-foreground">
            <InquiryAutoRefreshSwitch
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
