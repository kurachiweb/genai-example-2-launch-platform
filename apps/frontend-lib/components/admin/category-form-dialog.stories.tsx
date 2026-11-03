import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn, screen } from 'storybook/test';

import { CategoryFormDialog } from './category-form-dialog.tsx';

const meta = {
  title: '管理画面/CategoryFormDialog',
  component: CategoryFormDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    title: 'カテゴリを追加',
    submitLabel: '追加',
    initialValues: undefined,
    withHandle: false,
    onSubmit: fn(() => Promise.resolve()),
    failureMessageOf: fn(() => '同じ名前のカテゴリが既にあります。'),
  },
} satisfies Meta<typeof CategoryFormDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Create: Story = {};

export const EditWithHandle: Story = {
  args: {
    title: 'カテゴリ「開発ツール」を編集',
    submitLabel: '保存',
    initialValues: { name: '開発ツール', handle: 'developer-tools' },
    withHandle: true,
    validateHandle: (handle: string) =>
      /^[a-z0-9-]+$/u.test(handle)
        ? undefined
        : 'ハンドルは半角英小文字・数字・ハイフンで入力してください。',
  },
};

export const NameTooLong: Story = {
  play: async ({ userEvent }) => {
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'カテゴリ名' }),
      'あ'.repeat(31),
    );
    await userEvent.tab();
  },
};

export const SubmitRejected: Story = {
  args: {
    onSubmit: fn(() => Promise.reject(new Error('conflict'))),
  },
  play: async ({ userEvent }) => {
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'カテゴリ名' }),
      '開発ツール',
    );
    await userEvent.click(screen.getByRole('button', { name: '追加' }));
  },
};

export const Submitting: Story = {
  args: {
    onSubmit: fn(() => new Promise<void>(() => undefined)),
  },
  play: async ({ userEvent }) => {
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'カテゴリ名' }),
      '開発ツール',
    );
    await userEvent.click(screen.getByRole('button', { name: '追加' }));
  },
};
