import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Button } from '../button/button.tsx';
import { Popover } from './popover.tsx';
import { PopoverAnchor } from './popover-anchor.tsx';
import { PopoverContent } from './popover-content.tsx';
import { PopoverDescription } from './popover-description.tsx';
import { PopoverHeader } from './popover-header.tsx';
import { PopoverTitle } from './popover-title.tsx';
import { PopoverTrigger } from './popover-trigger.tsx';

const meta = {
  title: '重ねて表示する部品/Popover',
  component: Popover,
  render: (args) => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="outline">投票のしくみ</Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>投票のしくみ</PopoverTitle>
          <PopoverDescription>
            1つのプロダクトに1日1回まで投票できます。
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
} satisfies Meta<typeof Popover>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  args: { defaultOpen: true },
};

export const Anchored: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <Popover {...args}>
      <div className="flex flex-col items-start gap-2">
        <PopoverAnchor asChild>
          <p className="rounded-md border px-3 py-2 text-sm">
            この欄の下に表示します
          </p>
        </PopoverAnchor>
        <PopoverTrigger asChild>
          <Button variant="outline">補足を表示</Button>
        </PopoverTrigger>
      </div>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>補足</PopoverTitle>
          <PopoverDescription>
            開閉のボタンとは別の要素の位置に合わせて表示します。
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
};
