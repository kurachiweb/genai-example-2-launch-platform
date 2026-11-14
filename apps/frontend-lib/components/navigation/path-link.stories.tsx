import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { PathLink } from './path-link.tsx';

const meta = {
  title: '導線/PathLink',
  component: PathLink,
  args: {
    href: '/accounts',
    children: '管理者アカウント',
    className: 'text-primary underline',
  },
} satisfies Meta<typeof PathLink>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithQuery: Story = {
  args: {
    href: '/audit-logs?action=admin-account.invite',
    children: '監査ログ',
  },
};
