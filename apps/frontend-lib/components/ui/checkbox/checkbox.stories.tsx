import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Label } from '../label/label.tsx';
import { Checkbox } from './checkbox.tsx';

const meta = {
  title: '基本部品/Checkbox',
  component: Checkbox,
  args: { id: 'agreement' },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Checkbox {...args} />
      <Label htmlFor={args.id}>利用規約に同意する</Label>
    </div>
  ),
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
  args: { defaultChecked: true },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledChecked: Story = {
  args: { disabled: true, defaultChecked: true },
};
