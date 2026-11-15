import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { NumberText } from './number-text.tsx';

const meta = {
  title: '日時と数値/NumberText',
  component: NumberText,
  args: { value: 1234567 },
} satisfies Meta<typeof NumberText>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Percent: Story = {
  args: {
    value: 0.256,
    options: { style: 'percent', maximumFractionDigits: 1 },
  },
};

export const Compact: Story = {
  args: { options: { notation: 'compact' } },
};
