import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { MarkdownLengthCounter } from './markdown-length-counter.tsx';

const meta = {
  title: 'マークダウン/MarkdownLengthCounter',
  component: MarkdownLengthCounter,
  args: {
    value: 'あ'.repeat(1234),
    max: 2000,
  },
  render: (args) => (
    <div className="flex max-w-xl justify-end rounded-md border border-input bg-card px-3 py-1.5">
      <MarkdownLengthCounter {...args} />
    </div>
  ),
} satisfies Meta<typeof MarkdownLengthCounter>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OverLimit: Story = {
  args: { value: 'あ'.repeat(2034) },
};
