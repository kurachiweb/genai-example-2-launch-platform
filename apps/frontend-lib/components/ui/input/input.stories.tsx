import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Label } from '../label/label.tsx';
import { Input } from './input.tsx';

const meta = {
  title: '基本部品/Input',
  component: Input,
  args: { id: 'product-name', placeholder: 'Launch Stadium' },
  render: (args) => (
    <div className="flex max-w-sm flex-col gap-2">
      <Label htmlFor={args.id}>プロダクト名</Label>
      <Input {...args} />
    </div>
  ),
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Filled: Story = {
  args: { defaultValue: 'Launch Stadium' },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true, defaultValue: '' },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Launch Stadium' },
};
