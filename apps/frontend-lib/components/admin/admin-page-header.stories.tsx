import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Button } from '../ui/button/button.tsx';
import { AdminPageHeader } from './admin-page-header.tsx';

const meta = {
  title: '管理画面/AdminPageHeader',
  component: AdminPageHeader,
  args: {
    title: '管理者アカウント',
    description: '管理者の招待・ロールの変更・削除を行います。',
    actions: <Button type="button">招待する</Button>,
  },
} satisfies Meta<typeof AdminPageHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const TitleOnly: Story = {
  args: { description: undefined, actions: undefined },
};

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-64">
        <Story />
      </div>
    ),
  ],
  args: {
    actions: (
      <>
        <Button type="button">招待する</Button>
        <Button type="button" variant="outline">
          書き出す
        </Button>
      </>
    ),
  },
};
