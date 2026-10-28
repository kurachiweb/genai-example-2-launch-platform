import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { BellIcon } from 'lucide-react';

import { Button } from '../button/button.tsx';
import { Tooltip } from './tooltip.tsx';
import { TooltipContent } from './tooltip-content.tsx';
import { TooltipTrigger } from './tooltip-trigger.tsx';

const meta = {
  title: '重ねて表示する部品/Tooltip',
  component: Tooltip,
  render: (args) => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button size="icon" variant="outline">
          <BellIcon aria-hidden="true" />
          <span className="sr-only">通知</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>通知</TooltipContent>
    </Tooltip>
  ),
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  args: { defaultOpen: true },
};
