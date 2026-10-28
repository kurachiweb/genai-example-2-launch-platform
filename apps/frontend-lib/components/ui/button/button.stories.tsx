import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { PlusIcon } from 'lucide-react';
import { fn } from 'storybook/test';

import { Button } from './button.tsx';

const meta = {
  title: '基本部品/Button',
  component: Button,
  args: { children: '投稿する', onClick: fn() },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'destructive',
        'outline',
        'secondary',
        'ghost',
        'link',
      ],
    },
    size: {
      control: 'select',
      options: [
        'default',
        'xs',
        'sm',
        'lg',
        'icon',
        'icon-xs',
        'icon-sm',
        'icon-lg',
      ],
    },
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Destructive: Story = {
  args: { variant: 'destructive', children: '削除する' },
};

export const Outline: Story = {
  args: { variant: 'outline', children: 'キャンセル' },
};

export const Secondary: Story = {
  args: { variant: 'secondary', children: '下書きに保存' },
};

export const Ghost: Story = {
  args: { variant: 'ghost', children: '閉じる' },
};

export const Link: Story = {
  args: { variant: 'link', children: '詳しく見る' },
};

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <PlusIcon aria-hidden="true" />
        プロダクトを追加
      </>
    ),
  },
};

export const IconOnly: Story = {
  args: {
    size: 'icon',
    'aria-label': 'プロダクトを追加',
    children: <PlusIcon aria-hidden="true" />,
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};
