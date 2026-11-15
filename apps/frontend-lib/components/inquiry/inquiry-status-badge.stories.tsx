import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { INQUIRY_STATUSES } from '../../../common-lib/inquiry/inquiry-status.ts';
import { InquiryStatusBadge } from './inquiry-status-badge.tsx';

const meta = {
  title: '問い合わせ/InquiryStatusBadge',
  component: InquiryStatusBadge,
  args: { status: 'open' },
  argTypes: {
    status: { control: 'select', options: INQUIRY_STATUSES },
  },
} satisfies Meta<typeof InquiryStatusBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const InProgress: Story = {
  args: { status: 'in_progress' },
};

export const Resolved: Story = {
  args: { status: 'resolved' },
};

export const Rejected: Story = {
  args: { status: 'rejected' },
};

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {INQUIRY_STATUSES.map((status) => (
        <InquiryStatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
