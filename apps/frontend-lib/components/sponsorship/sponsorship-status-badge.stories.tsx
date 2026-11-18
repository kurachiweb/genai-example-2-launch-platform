import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { SPONSORSHIP_STATUSES } from '../../../common-lib/sponsorship/sponsorship-status.ts';
import { SponsorshipStatusBadge } from './sponsorship-status-badge.tsx';

const meta = {
  title: 'スポンサー広告/SponsorshipStatusBadge',
  component: SponsorshipStatusBadge,
  args: { status: 'active' },
  argTypes: {
    status: { control: 'select', options: SPONSORSHIP_STATUSES },
  },
} satisfies Meta<typeof SponsorshipStatusBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Active: Story = {};

export const Paused: Story = {
  args: { status: 'paused' },
};

export const Terminated: Story = {
  args: { status: 'terminated' },
};

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {SPONSORSHIP_STATUSES.map((status) => (
        <SponsorshipStatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
