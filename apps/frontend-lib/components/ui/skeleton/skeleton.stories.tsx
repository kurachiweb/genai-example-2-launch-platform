import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Skeleton } from './skeleton.tsx';

const meta = {
  title: '基本部品/Skeleton',
  component: Skeleton,
  args: { className: 'h-4 w-64' },
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Card: Story = {
  render: () => (
    <div className="flex max-w-sm items-center gap-4">
      <Skeleton className="size-12 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  ),
};
