import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import {
  AdminDataTable,
  type AdminDataTableColumn,
  type AdminDataTableProps,
} from './admin-data-table.tsx';

interface AdminRow {
  readonly id: string;
  readonly nickname: string;
  readonly email: string;
  readonly role: string;
}

const ROWS: readonly AdminRow[] = [
  {
    id: 'a1',
    nickname: '山田',
    email: 'yamada@mail.example',
    role: '最上位管理者',
  },
  { id: 'a2', nickname: '佐藤', email: 'sato@mail.example', role: '運営者' },
  { id: 'a3', nickname: '鈴木', email: 'suzuki@mail.example', role: '閲覧者' },
];

const COLUMNS: readonly AdminDataTableColumn<AdminRow>[] = [
  { key: 'nickname', header: 'ニックネーム', cell: (row) => row.nickname },
  { key: 'email', header: 'メールアドレス', cell: (row) => row.email },
  { key: 'role', header: 'ロール', cell: (row) => row.role },
];

const WIDE_COLUMNS: readonly AdminDataTableColumn<AdminRow>[] = [
  ...COLUMNS,
  {
    key: 'note',
    header: '備考',
    cell: () => 'カテゴリマスタとユーザーの通報の対応を担当する',
    className: 'min-w-96',
  },
];

const meta = {
  title: '管理画面/AdminDataTable',
  component: AdminDataTable<AdminRow>,
  args: {
    caption: '管理者の一覧',
    columns: COLUMNS,
    rows: ROWS,
    rowKey: (row) => row.id,
    emptyMessage: '管理者はまだいません。',
    pagination: {
      hasPrevious: true,
      hasNext: true,
      onPrevious: fn(),
      onNext: fn(),
    },
  },
} satisfies Meta<AdminDataTableProps<AdminRow>>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FirstPage: Story = {
  args: {
    pagination: {
      hasPrevious: false,
      hasNext: true,
      onPrevious: fn(),
      onNext: fn(),
    },
  },
};

export const LastPage: Story = {
  args: {
    pagination: {
      hasPrevious: true,
      hasNext: false,
      onPrevious: fn(),
      onNext: fn(),
    },
  },
};

export const WithoutPagination: Story = {
  args: { pagination: undefined },
};

export const Loading: Story = {
  args: { rows: undefined },
};

export const Empty: Story = {
  args: { rows: [], pagination: undefined },
};

export const EmptyWithPreviousPage: Story = {
  args: {
    rows: [],
    pagination: {
      hasPrevious: true,
      hasNext: false,
      onPrevious: fn(),
      onNext: fn(),
    },
  },
};

export const Failed: Story = {
  args: {
    rows: undefined,
    error: {
      message:
        '管理者の一覧を読み込めませんでした。時間をおいて再度お試しください。',
      onRetry: fn(),
    },
  },
};

export const HorizontalScroll: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-80">
        <Story />
      </div>
    ),
  ],
  args: { columns: WIDE_COLUMNS },
};
