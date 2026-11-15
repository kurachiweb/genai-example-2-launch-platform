import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Label } from '../label/label.tsx';
import { Switch } from './switch.tsx';

const meta = {
  title: '基本部品/Switch',
  component: Switch,
  args: { id: 'public-profile' },
  argTypes: { size: { control: 'select', options: ['default', 'sm'] } },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Switch {...args} />
      <Label htmlFor={args.id}>プロフィールを公開する</Label>
    </div>
  ),
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
  args: { defaultChecked: true },
};

export const Small: Story = {
  args: { size: 'sm' },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledChecked: Story = {
  args: { disabled: true, defaultChecked: true },
};
