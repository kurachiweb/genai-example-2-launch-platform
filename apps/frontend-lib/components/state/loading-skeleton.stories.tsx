import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Skeleton } from '../ui/skeleton/skeleton.tsx';
import { LoadingSkeleton } from './loading-skeleton.tsx';

const meta = {
  title: '状態表示/LoadingSkeleton',
  component: LoadingSkeleton,
} satisfies Meta<typeof LoadingSkeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomShape: Story = {
  args: {
    label: 'ランキングを読み込み中',
    children: (
      <div className="flex flex-col gap-4">
        {['first', 'second', 'third'].map((key) => (
          <div key={key} className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-xl" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    ),
  },
};
