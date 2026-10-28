import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { UnexpectedErrorView } from './unexpected-error-view.tsx';

const meta = {
  title: 'エラーの表示/UnexpectedErrorView',
  component: UnexpectedErrorView,
  args: { onRetry: fn(), contactHref: '/contact' },
} satisfies Meta<typeof UnexpectedErrorView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
