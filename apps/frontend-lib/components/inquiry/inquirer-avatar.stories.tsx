import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { InquirerAvatar } from './inquirer-avatar.tsx';

const OBJECT_KEY = 'fedcba9876543210'.repeat(2);

// 画像はカタログの公開の設定の画像配信のオリジン(ローカルのイベントサーバー)から読み、配信されていなければ読み込みの失敗の既定のアイコンになる
const meta = {
  title: '問い合わせ/InquirerAvatar',
  component: InquirerAvatar,
  args: {
    image: {
      objectKey: OBJECT_KEY,
      fallbackFormat: 'JPG',
      width: 512,
      height: 512,
    },
    nickname: 'サンプル太郎',
    size: 'sm',
  },
} satisfies Meta<typeof InquirerAvatar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithImage: Story = {};

export const NoImage: Story = {
  args: { image: null },
};

export const Unavailable: Story = {
  args: {
    image: {
      objectKey: null,
      fallbackFormat: 'JPG',
      width: 512,
      height: 512,
    },
  },
};

export const Sizes: Story = {
  args: { image: null },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <InquirerAvatar {...args} size="xs" />
      <InquirerAvatar {...args} size="sm" />
      <span className="text-sm">{args.nickname}</span>
    </div>
  ),
};
