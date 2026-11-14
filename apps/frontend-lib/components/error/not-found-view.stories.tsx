import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { NotFoundView } from './not-found-view.tsx';

const meta = {
  title: 'エラーの表示/NotFoundView',
  component: NotFoundView,
  args: {
    links: [
      { href: '/', label: 'トップページへ' },
      { href: '/ranking', label: 'ランキングを見る' },
    ],
  },
} satisfies Meta<typeof NotFoundView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SingleLink: Story = {
  args: { links: [{ href: '/', label: 'トップページへ' }] },
};
