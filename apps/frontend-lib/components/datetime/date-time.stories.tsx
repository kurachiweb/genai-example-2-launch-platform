import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { DateTime } from './date-time.tsx';

const meta = {
  title: '日時と数値/DateTime',
  component: DateTime,
  args: { value: '2026-01-15T07:40:00.000Z', format: 'longDateTime' },
  argTypes: {
    format: {
      control: 'select',
      options: [
        'time',
        'date',
        'dateWeekday',
        'yearDate',
        'longDate',
        'dateTime',
        'longDateTime',
      ],
    },
  },
} satisfies Meta<typeof DateTime>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Time: Story = {
  args: { format: 'time' },
};

export const DateWithWeekday: Story = {
  args: { format: 'dateWeekday' },
};

export const YearDate: Story = {
  args: { format: 'yearDate' },
};

export const DateAndTime: Story = {
  args: { format: 'dateTime' },
};
