import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Button } from '../ui/button/button.tsx';
import { EmptyState } from './empty-state.tsx';

const meta = {
  title: '状態表示/EmptyState',
  component: EmptyState,
  args: {
    title: 'まだプロダクトがありません。',
    description: '最初のプロダクトを投稿して、投票を集めましょう。',
  },
} satisfies Meta<typeof EmptyState>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = {
  args: {
    action: (
      <Button asChild>
        <a href="#new-product">プロダクトを投稿する</a>
      </Button>
    ),
  },
};

export const AsSection: Story = {
  args: { headingLevel: 2 },
};

export const TitleOnly: Story = {
  args: { description: undefined },
};
