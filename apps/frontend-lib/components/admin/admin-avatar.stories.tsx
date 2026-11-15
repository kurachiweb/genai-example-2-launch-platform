import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { AdminAvatar } from './admin-avatar.tsx';

const OBJECT_KEY = '0123456789abcdef'.repeat(2);

// 画像はカタログの公開の設定の画像配信のオリジン(ローカルのイベントサーバー)から読み、配信されていなければ読み込みの失敗の既定のアイコンになる
const meta = {
  title: '管理画面/AdminAvatar',
  component: AdminAvatar,
  args: {
    image: {
      objectKey: OBJECT_KEY,
      fallbackFormat: 'JPG',
      width: 512,
      height: 512,
    },
    nickname: 'サンプル管理者',
    size: 64,
  },
} satisfies Meta<typeof AdminAvatar>;

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
      <AdminAvatar {...args} size={32} />
      <AdminAvatar {...args} size={64} />
      <AdminAvatar
        {...args}
        size={128}
        alt="サンプル管理者のプロフィール画像"
      />
      <span className="text-sm">サンプル管理者</span>
    </div>
  ),
};
