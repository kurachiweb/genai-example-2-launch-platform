import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { ErrorState } from './error-state.tsx';

const meta = {
  title: '状態表示/ErrorState',
  component: ErrorState,
  args: {
    message: '通信に失敗しました。時間をおいて再度お試しください。',
    onRetry: fn(),
    contactHref: '/contact',
  },
} satisfies Meta<typeof ErrorState>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutContact: Story = {
  args: {
    message: '一覧を読み込めませんでした。時間をおいて再度お試しください。',
    contactHref: undefined,
  },
};
