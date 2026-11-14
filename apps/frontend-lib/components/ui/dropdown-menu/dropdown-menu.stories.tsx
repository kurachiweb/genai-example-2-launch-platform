import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { LogOutIcon, SettingsIcon, UserIcon } from 'lucide-react';

import { Button } from '../button/button.tsx';
import { DropdownMenu } from './dropdown-menu.tsx';
import { DropdownMenuCheckboxItem } from './dropdown-menu-checkbox-item.tsx';
import { DropdownMenuContent } from './dropdown-menu-content.tsx';
import { DropdownMenuGroup } from './dropdown-menu-group.tsx';
import { DropdownMenuItem } from './dropdown-menu-item.tsx';
import { DropdownMenuLabel } from './dropdown-menu-label.tsx';
import { DropdownMenuPortal } from './dropdown-menu-portal.tsx';
import { DropdownMenuRadioGroup } from './dropdown-menu-radio-group.tsx';
import { DropdownMenuRadioItem } from './dropdown-menu-radio-item.tsx';
import { DropdownMenuSeparator } from './dropdown-menu-separator.tsx';
import { DropdownMenuShortcut } from './dropdown-menu-shortcut.tsx';
import { DropdownMenuSub } from './dropdown-menu-sub.tsx';
import { DropdownMenuSubContent } from './dropdown-menu-sub-content.tsx';
import { DropdownMenuSubTrigger } from './dropdown-menu-sub-trigger.tsx';
import { DropdownMenuTrigger } from './dropdown-menu-trigger.tsx';

const meta = {
  title: '重ねて表示する部品/DropdownMenu',
  component: DropdownMenu,
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">アカウント</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>マイアカウント</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <UserIcon aria-hidden="true" />
            プロフィール
            <DropdownMenuShortcut>⇧P</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <SettingsIcon aria-hidden="true" />
            設定
          </DropdownMenuItem>
          <DropdownMenuItem disabled>請求情報</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked>
          投票の通知を受け取る
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel inset>並び順</DropdownMenuLabel>
        <DropdownMenuRadioGroup value="votes">
          <DropdownMenuRadioItem value="votes">投票数</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="newest">新着</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>共有</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuItem>リンクをコピー</DropdownMenuItem>
              <DropdownMenuItem>メールで送る</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <LogOutIcon aria-hidden="true" />
          ログアウト
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
} satisfies Meta<typeof DropdownMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  args: { defaultOpen: true },
  parameters: {
    // 開いたメニューの外側はaria-hiddenになりフォーカスもメニューの中に閉じ込められるが、検査はダイアログ以外の重ねた表示を判定できず外側の開いた元の要素を違反に数えるため、開いたメニューだけを検査する
    a11y: { context: '[data-slot="dropdown-menu-content"]' },
  },
};
