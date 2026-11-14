import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Switch } from '../switch/switch.tsx';
import { Label } from './label.tsx';

const meta = {
  title: '基本部品/Label',
  component: Label,
  args: { htmlFor: 'notify-votes', children: '投票の通知を受け取る' },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Switch id="notify-votes" />
      <Label {...args} />
    </div>
  ),
} satisfies Meta<typeof Label>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Switch id="notify-votes" disabled />
      <Label {...args} />
    </div>
  ),
};
