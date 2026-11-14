import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn, screen } from 'storybook/test';

import { ConfirmActionDialog } from './confirm-action-dialog.tsx';

const meta = {
  title: '管理画面/ConfirmActionDialog',
  component: ConfirmActionDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    title: '管理者「サンプル管理者」を削除しますか?',
    description: '削除した管理者はログインできなくなり、元に戻せません。',
    confirmLabel: '削除',
    reason: 'optional',
    audited: true,
    onConfirm: fn(() => Promise.resolve()),
    failureMessageOf: fn(() => 'この操作を行う権限がありません。'),
  },
} satisfies Meta<typeof ConfirmActionDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const OptionalReason: Story = {};

export const RequiredReason: Story = {
  args: {
    title: 'ユーザー「サンプル太郎」を停止しますか?',
    description: '停止したユーザーはログインできなくなります。',
    confirmLabel: '停止',
    reason: 'required',
  },
};

export const WithoutReason: Story = {
  args: {
    title: 'カテゴリ「開発ツール」を削除しますか?',
    description: '削除したカテゴリは元に戻せません。',
    reason: 'none',
    audited: false,
  },
};

export const ReasonTooLong: Story = {
  args: { reason: 'required' },
  play: async ({ userEvent }) => {
    await userEvent.type(
      await screen.findByRole('textbox', { name: '理由(必須)' }),
      'あ'.repeat(501),
    );
    await userEvent.tab();
  },
};

export const ConfirmFailed: Story = {
  args: {
    onConfirm: fn(() => Promise.reject(new Error('forbidden'))),
  },
  play: async ({ userEvent }) => {
    await userEvent.type(
      await screen.findByRole('textbox', { name: '理由(任意)' }),
      '重複して招待したため',
    );
    await userEvent.click(screen.getByRole('button', { name: '削除' }));
  },
};

export const Confirming: Story = {
  args: {
    onConfirm: fn(() => new Promise<void>(() => undefined)),
  },
  play: async ({ userEvent }) => {
    await userEvent.click(await screen.findByRole('button', { name: '削除' }));
  },
};
