import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Label } from '../label/label.tsx';
import { Textarea } from './textarea.tsx';

const meta = {
  title: '基本部品/Textarea',
  component: Textarea,
  args: {
    id: 'product-description',
    placeholder: 'プロダクトの特徴を書いてください',
  },
  render: (args) => (
    <div className="flex max-w-md flex-col gap-2">
      <Label htmlFor={args.id}>説明</Label>
      <Textarea {...args} />
    </div>
  ),
} satisfies Meta<typeof Textarea>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Filled: Story = {
  args: {
    defaultValue:
      '作った製品を投稿し、他のユーザーと投票数を競い合うローンチプラットフォームです。',
  },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: '編集できない説明' },
};
