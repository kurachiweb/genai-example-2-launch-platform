import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { UnavailableNotice } from './unavailable-notice.tsx';

const meta = {
  title: '状態表示/UnavailableNotice',
  component: UnavailableNotice,
  args: {
    reason:
      '決済の処理が一時的に停止しているため、プランの変更を受け付けていません。',
  },
} satisfies Meta<typeof UnavailableNotice>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
