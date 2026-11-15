import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Badge } from './badge.tsx';

const meta = {
  title: '基本部品/Badge',
  component: Badge,
  args: { children: '新着' },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'secondary',
        'destructive',
        'outline',
        'ghost',
        'link',
      ],
    },
    size: { control: 'select', options: ['default', 'lg'] },
  },
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Secondary: Story = {
  args: { variant: 'secondary', children: '開発ツール' },
};

export const Destructive: Story = {
  args: { variant: 'destructive', children: '非公開' },
};

export const Outline: Story = {
  args: { variant: 'outline', children: '下書き' },
};

export const Large: Story = {
  args: { size: 'lg', children: '1位' },
};
