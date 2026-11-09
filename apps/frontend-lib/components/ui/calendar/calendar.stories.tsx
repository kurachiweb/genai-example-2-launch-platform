import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { Calendar } from './calendar.tsx';

const NOVEMBER = new Date(2026, 10, 1);
const TODAY = new Date(2026, 10, 9);
const FIRST_AVAILABLE = new Date(2026, 10, 11);
const INTERVAL_START = new Date(2026, 10, 14);
const INTERVAL_END = new Date(2026, 10, 16);
const LAST_AVAILABLE = new Date(2026, 11, 20);

function launchDateReasonOf(date: Date): string | undefined {
  if (date < FIRST_AVAILABLE) {
    return 'ペアリングの締め切りを過ぎています';
  }
  if (date >= INTERVAL_START && date <= INTERVAL_END) {
    return '敗北後の間隔のため選べません';
  }
  if (date > LAST_AVAILABLE) {
    return '選べる期間の外です';
  }
  return undefined;
}

const meta = {
  title: '基本部品/Calendar',
  component: Calendar,
  args: {
    mode: 'single',
    defaultMonth: NOVEMBER,
    today: TODAY,
    onSelect: fn(),
  },
} satisfies Meta<typeof Calendar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selected: Story = {
  args: { selected: new Date(2026, 10, 12) },
};

export const UnavailableDays: Story = {
  args: { unavailableReasonOf: launchDateReasonOf },
};

export const UnavailableDayReasonOpen: Story = {
  args: { unavailableReasonOf: launchDateReasonOf },
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(
      await canvas.findByRole('button', {
        name: '2026年11月15日日曜日、敗北後の間隔のため選べません',
      }),
    );
  },
};
