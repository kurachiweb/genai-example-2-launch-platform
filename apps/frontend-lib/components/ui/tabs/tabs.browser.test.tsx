import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
} from '../../../test/computed-style.ts';
import { pressKeyUntilFocusMoves } from '../../../test/keyboard.ts';
import { Tabs } from './tabs.tsx';
import { TabsContent } from './tabs-content.tsx';
import { TabsList } from './tabs-list.tsx';
import type { TabsListVariant } from './tabs-list-variants.ts';
import { TabsTrigger } from './tabs-trigger.tsx';

const VARIANTS: readonly TabsListVariant[] = ['default', 'line'];

function ProfileTabs({
  variant,
  orientation,
  disablesAwards = false,
}: {
  readonly variant?: TabsListVariant;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly disablesAwards?: boolean;
}) {
  return (
    <Tabs defaultValue="launches" orientation={orientation}>
      <TabsList aria-label="プロフィールの内容" variant={variant}>
        <TabsTrigger value="launches">ローンチしたプロダクト</TabsTrigger>
        <TabsTrigger value="awards" disabled={disablesAwards}>
          受賞
        </TabsTrigger>
        <TabsTrigger value="upvotes">Upvote履歴</TabsTrigger>
      </TabsList>
      <TabsContent value="launches">
        まだローンチしたプロダクトはありません。
      </TabsContent>
      <TabsContent value="awards">受賞はまだありません。</TabsContent>
      <TabsContent value="upvotes">
        まだUpvoteしたマッチはありません。
      </TabsContent>
    </Tabs>
  );
}

const tab = (name: string) => page.getByRole('tab', { name });
const panel = (name: string) => page.getByRole('tabpanel', { name });

async function expectSelected(name: string): Promise<void> {
  await expect.element(tab(name)).toHaveFocus();
  await expect.element(tab(name)).toHaveAttribute('aria-selected', 'true');
  await expect.element(panel(name)).toBeVisible();
}

afterEach(() => {
  applyColorScheme('light');
});

describe('Tabs', () => {
  test('Tabで選択中のタブへフォーカスが移り、左右の矢印キーでタブを移って内容を切り替え、端では反対の端へ移る', async () => {
    await render(<ProfileTabs />);

    await userEvent.tab();
    await expectSelected('ローンチしたプロダクト');
    await pressKeyUntilFocusMoves('ArrowRight');
    await expectSelected('受賞');
    await pressKeyUntilFocusMoves('ArrowRight');
    await expectSelected('Upvote履歴');
    await pressKeyUntilFocusMoves('ArrowRight');
    await expectSelected('ローンチしたプロダクト');
    await pressKeyUntilFocusMoves('ArrowLeft');
    await expectSelected('Upvote履歴');

    await expect
      .element(page.getByRole('tablist', { name: 'プロフィールの内容' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText('まだローンチしたプロダクトはありません。'))
      .not.toBeInTheDocument();
  });

  test('HomeとEndで最初と最後のタブへ移る', async () => {
    await render(<ProfileTabs />);
    await userEvent.tab();

    await pressKeyUntilFocusMoves('End');
    await expectSelected('Upvote履歴');
    await pressKeyUntilFocusMoves('Home');
    await expectSelected('ローンチしたプロダクト');
  });

  test('無効のタブは、矢印キーの移動先にならず、無効であることを示す', async () => {
    await render(<ProfileTabs disablesAwards />);
    await userEvent.tab();

    await pressKeyUntilFocusMoves('ArrowRight');

    await expectSelected('Upvote履歴');
    await expect.element(tab('受賞')).toBeDisabled();
    expect(getComputedStyle(tab('受賞').element()).opacity).toBe('0.5');
  });

  test('縦に並べた時は、上下の矢印キーでタブを移る', async () => {
    await render(<ProfileTabs orientation="vertical" />);
    await userEvent.tab();

    await pressKeyUntilFocusMoves('ArrowDown');
    await expectSelected('受賞');
    await pressKeyUntilFocusMoves('ArrowUp');

    await expectSelected('ローンチしたプロダクト');
    await expect
      .element(page.getByRole('tablist'))
      .toHaveAttribute('aria-orientation', 'vertical');
  });

  test('タブからTabを押すと、選択中のタブの内容へフォーカスが移る', async () => {
    await render(<ProfileTabs />);
    await userEvent.tab();

    await userEvent.tab();

    await expect.element(panel('ローンチしたプロダクト')).toHaveFocus();
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、キーボードで移ったフォーカスをタブと内容のリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<ProfileTabs />);

      await userEvent.tab();
      await expect
        .poll(() => outlineOf(tab('ローンチしたプロダクト').element()))
        .toStrictEqual(ringOutline());
      await userEvent.tab();

      await expect
        .poll(() => outlineOf(panel('ローンチしたプロダクト').element()))
        .toStrictEqual(ringOutline());
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each(VARIANTS)(
      '見た目の種類が%sで、選択中・未選択・無効のタブのアクセシビリティの検査の違反が0件',
      async (variant) => {
        applyColorScheme(scheme);
        const { container } = await render(
          <div className="p-4">
            <ProfileTabs variant={variant} disablesAwards />
          </div>,
        );

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});
