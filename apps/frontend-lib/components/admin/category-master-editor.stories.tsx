import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn, screen } from 'storybook/test';

import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import { CategoryMasterEditor } from './category-master-editor.tsx';

const HANDLE_FORMAT_MESSAGE =
  'ハンドルは半角英小文字・数字・ハイフンで入力してください。';

const meta = {
  title: '管理画面/CategoryMasterEditor',
  component: CategoryMasterEditor,
  args: {
    title: 'プロダクトカテゴリ',
    categories: [
      {
        id: 'c1',
        name: '開発ツール',
        handle: 'developer-tools',
        systemDefault: false,
      },
      { id: 'c2', name: 'デザイン', handle: 'design', systemDefault: false },
      { id: 'c3', name: '生産性', systemDefault: false },
      { id: 'c4', name: 'その他', handle: 'other', systemDefault: true },
    ],
    withHandle: true,
    canEdit: true,
    validateHandle: (handle: string) =>
      /^[a-z0-9-]+$/u.test(handle) ? undefined : HANDLE_FORMAT_MESSAGE,
    onCreate: fn(() => Promise.resolve()),
    onUpdate: fn(() => Promise.resolve()),
    onDelete: fn(() => Promise.resolve()),
    failureMessageOf: fn(
      () => 'このカテゴリはプロダクトに使われているため削除できません。',
    ),
  },
} satisfies Meta<typeof CategoryMasterEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithHandle: Story = {};

export const WithoutHandle: Story = {
  args: {
    title: '問い合わせカテゴリ',
    withHandle: false,
    categories: [
      { id: 'c1', name: 'アカウント', systemDefault: false },
      { id: 'c2', name: '決済', systemDefault: false },
      { id: 'c3', name: 'その他', systemDefault: true },
    ],
  },
};

export const ReadOnly: Story = {
  args: { canEdit: false },
};

export const ReadOnlyHidden: Story = {
  args: { canEdit: false, readOnlyDisplay: 'hidden' },
};

export const Loading: Story = {
  args: { categories: undefined },
};

export const Empty: Story = {
  args: { categories: [] },
};

export const Creating: Story = {
  play: async ({ userEvent }) => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'カテゴリを追加' }),
    );
  },
};

export const InvalidInput: Story = {
  play: async ({ userEvent }) => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'カテゴリを追加' }),
    );
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'カテゴリ名(必須)' }),
      'あ'.repeat(31),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'ハンドル' }),
      'Developer Tools',
    );
    await userEvent.tab();
  },
};

export const Editing: Story = {
  play: async ({ userEvent }) => {
    await userEvent.click(
      await screen.findByRole('button', { name: '「開発ツール」を編集' }),
    );
  },
};

export const SaveRejected: Story = {
  args: {
    onUpdate: fn(() => Promise.reject(new Error('conflict'))),
    failureMessageOf: fn(() => '同じ名前のカテゴリが既にあります。'),
  },
  play: async ({ userEvent }) => {
    await userEvent.click(
      await screen.findByRole('button', { name: '「デザイン」を編集' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: '保存' }));
  },
};

export const ConfirmDeletion: Story = {
  play: async ({ userEvent }) => {
    await userEvent.click(
      await screen.findByRole('button', { name: '「開発ツール」を削除' }),
    );
  },
};

export const ConfirmAuditedDeletionWithDescription: Story = {
  args: {
    title: '問い合わせカテゴリ',
    withHandle: false,
    categories: [
      { id: 'c1', name: 'アカウント', systemDefault: false },
      { id: 'c2', name: '決済', systemDefault: false },
      { id: 'c3', name: 'その他', systemDefault: true },
    ],
    deleteDescriptionOf: (category) =>
      `「${category.name}」に紐付く3件の問い合わせは標準カテゴリ「その他」へ付け替えられます。`,
    deleteAudited: true,
  },
  play: async ({ userEvent }) => {
    await userEvent.click(
      await screen.findByRole('button', { name: '「アカウント」を削除' }),
    );
  },
};

export const DeletionRejected: Story = {
  args: {
    onDelete: fn(() => Promise.reject(new Error('in use'))),
  },
  play: async ({ userEvent }) => {
    await userEvent.click(
      await screen.findByRole('button', { name: '「開発ツール」を削除' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: '削除' }));
  },
};

export const SaveRejectedOnFields: Story = {
  args: {
    serverFieldPrefix: 'input',
    onCreate: fn(() =>
      Promise.reject(
        new GraphQLClientError({
          code: 'category_name_taken',
          message: 'このカテゴリ名は既に使われています。',
          status: 409,
          details: [
            {
              field: 'input.name',
              code: 'unavailable',
              message: 'このカテゴリ名は既に使われています。',
            },
            {
              field: 'input.handle',
              code: 'unavailable',
              message: 'このハンドルは既に使われています。',
            },
          ],
        }),
      ),
    ),
  },
  play: async ({ userEvent }) => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'カテゴリを追加' }),
    );
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'カテゴリ名(必須)' }),
      '開発ツール',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'ハンドル' }),
      'developer-tools',
    );
    await userEvent.click(screen.getByRole('button', { name: '追加' }));
  },
};
