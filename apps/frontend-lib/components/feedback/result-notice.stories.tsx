import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { INLINE_LINK_CLASS_NAME } from '../navigation/inline-link-class.ts';
import { ResultNotice } from './result-notice.tsx';

const meta = {
  title: 'フィードバック/ResultNotice',
  component: ResultNotice,
  args: {
    tone: 'success',
    message:
      'パスワードを再設定しました。新しいパスワードでログインしてください。',
    children: (
      <a href="#login" className={INLINE_LINK_CLASS_NAME}>
        ログイン画面へ
      </a>
    ),
  },
} satisfies Meta<typeof ResultNotice>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Success: Story = {};

export const Error: Story = {
  args: {
    tone: 'error',
    message: 'このリンクは無効か、有効期限が切れています。',
  },
};

export const MessageOnly: Story = {
  args: { children: undefined },
};
