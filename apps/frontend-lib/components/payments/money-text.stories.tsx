import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { MoneyText } from './money-text.tsx';

const meta = {
  title: '決済/MoneyText',
  component: MoneyText,
  args: { amount: 1500 },
  argTypes: {
    signDisplay: { control: 'select', options: ['auto', 'exceptZero'] },
  },
} satisfies Meta<typeof MoneyText>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LargeAmount: Story = {
  args: { amount: 123_456_789 },
};

export const Negative: Story = {
  args: { amount: -1500 },
};

export const SignedPositive: Story = {
  args: { amount: 1500, signDisplay: 'exceptZero' },
};

export const SignedNegative: Story = {
  args: { amount: -500, signDisplay: 'exceptZero' },
};

export const Zero: Story = {
  args: { amount: 0, signDisplay: 'exceptZero' },
};
