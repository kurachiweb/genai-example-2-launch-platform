import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { RelativeTime } from './relative-time.tsx';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const fromNow = (offsetMs: number): Date => new Date(Date.now() + offsetMs);

const meta = {
  title: '日時と数値/RelativeTime',
  component: RelativeTime,
  args: { target: fromNow(3 * DAY_MS), kind: 'remaining', format: 'dateTime' },
  argTypes: {
    kind: { control: 'select', options: ['remaining', 'elapsed'] },
  },
} satisfies Meta<typeof RelativeTime>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Remaining: Story = {};

export const Expired: Story = {
  args: { target: fromNow(-HOUR_MS) },
};

export const Elapsed: Story = {
  args: { target: fromNow(-5 * HOUR_MS), kind: 'elapsed' },
};

export const ElapsedLongAgo: Story = {
  args: { target: fromNow(-60 * DAY_MS), kind: 'elapsed', format: 'yearDate' },
};
