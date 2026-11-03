import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { Input } from '../ui/input/input.tsx';
import { Label } from '../ui/label/label.tsx';
import { Select } from '../ui/select/select.tsx';
import { SelectContent } from '../ui/select/select-content.tsx';
import { SelectItem } from '../ui/select/select-item.tsx';
import { SelectTrigger } from '../ui/select/select-trigger.tsx';
import { SelectValue } from '../ui/select/select-value.tsx';
import { AdminFilterBar } from './admin-filter-bar.tsx';

function AuditLogFields() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="keyword">キーワード</Label>
        <Input id="keyword" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="role">ロール</Label>
        <Select defaultValue="all">
          <SelectTrigger id="role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全て</SelectItem>
            <SelectItem value="operator">運営者</SelectItem>
            <SelectItem value="viewer">閲覧者</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

const meta = {
  title: '管理画面/AdminFilterBar',
  component: AdminFilterBar,
  args: {
    children: <AuditLogFields />,
    onApply: fn(),
    onReset: fn(),
  },
} satisfies Meta<typeof AdminFilterBar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-64">
        <Story />
      </div>
    ),
  ],
};
