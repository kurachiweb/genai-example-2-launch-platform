import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Table } from './table.tsx';
import { TableBody } from './table-body.tsx';
import { TableCaption } from './table-caption.tsx';
import { TableCell } from './table-cell.tsx';
import { TableFooter } from './table-footer.tsx';
import { TableHead } from './table-head.tsx';
import { TableHeader } from './table-header.tsx';
import { TableRow } from './table-row.tsx';

const ADMINS = [
  { nickname: '山田', email: 'yamada@mail.example', role: '最上位管理者' },
  { nickname: '佐藤', email: 'sato@mail.example', role: '運営者' },
  { nickname: '鈴木', email: 'suzuki@mail.example', role: '閲覧者' },
] as const;

const SELECTED_EMAIL = 'sato@mail.example';

const meta = {
  title: '基本部品/Table',
  component: Table,
  render: (args) => (
    <Table {...args}>
      <TableCaption>管理者の一覧</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">ニックネーム</TableHead>
          <TableHead scope="col">メールアドレス</TableHead>
          <TableHead scope="col">ロール</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ADMINS.map(({ nickname, email, role }) => (
          <TableRow
            key={email}
            data-state={email === SELECTED_EMAIL ? 'selected' : undefined}
          >
            <TableHead scope="row">{nickname}</TableHead>
            <TableCell>{email}</TableCell>
            <TableCell>{role}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableHead scope="row">合計</TableHead>
          <TableCell colSpan={2}>{ADMINS.length}人</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
} satisfies Meta<typeof Table>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const HorizontalScroll: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-64">
        <Story />
      </div>
    ),
  ],
  args: { className: 'min-w-xl' },
};
