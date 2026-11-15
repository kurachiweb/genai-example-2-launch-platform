import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { InquirerAvatar } from './inquirer-avatar.tsx';
import { InquiryMessageCard } from './inquiry-message-card.tsx';

const meta = {
  title: '問い合わせ/InquiryMessageCard',
  component: InquiryMessageCard,
  args: {
    side: 'other',
    senderLabel: 'サポート担当',
    avatar: <InquirerAvatar image={null} nickname="サポート担当" size="xs" />,
    body: 'お問い合わせありがとうございます。\n詳しい状況を確認しますので、少々お待ちください。',
    attachments: [],
    createdAt: '2026-01-15T07:40:00.000Z',
  },
  render: (args) => (
    <div className="max-w-xl">
      <InquiryMessageCard {...args} />
    </div>
  ),
} satisfies Meta<typeof InquiryMessageCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const FromOther: Story = {};

export const FromSelf: Story = {
  args: {
    side: 'self',
    senderLabel: 'サンプル太郎',
    avatar: <InquirerAvatar image={null} nickname="サンプル太郎" size="xs" />,
    body: 'ログインできません。\n画面の様子を添付します。',
    attachments: [
      {
        id: 'file-1',
        originalFileName: 'screenshot.png',
        contentType: 'image/png',
        byteSize: Math.round(1.5 * 1024 * 1024),
      },
      {
        id: 'file-2',
        originalFileName: 'error-log.txt',
        contentType: 'text/plain',
        byteSize: 512,
      },
    ],
  },
};

export const DeletedAdmin: Story = {
  args: {
    senderLabel: '削除済みの管理者',
    avatar: (
      <InquirerAvatar image={null} nickname="削除済みの管理者" size="xs" />
    ),
  },
};

export const HtmlLikeBody: Story = {
  args: {
    body: '<b>太字にはならない</b>\n<script>alert(1)</script>',
  },
};
