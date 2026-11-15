import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { PartialErrorState } from './partial-error-state.tsx';

const meta = {
  title: '状態表示/PartialErrorState',
  component: PartialErrorState,
  args: {
    message: 'コメントを読み込めませんでした。',
    onRetry: fn(),
  },
} satisfies Meta<typeof PartialErrorState>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
