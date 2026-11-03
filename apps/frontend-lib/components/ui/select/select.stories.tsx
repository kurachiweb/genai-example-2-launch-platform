import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { Label } from '../label/label.tsx';
import { Select } from './select.tsx';
import { SelectContent } from './select-content.tsx';
import { SelectGroup } from './select-group.tsx';
import { SelectItem } from './select-item.tsx';
import { SelectLabel } from './select-label.tsx';
import { SelectSeparator } from './select-separator.tsx';
import { SelectTrigger } from './select-trigger.tsx';
import type { SelectTriggerSize } from './select-trigger.tsx';
import { SelectValue } from './select-value.tsx';

function RoleOptions() {
  return (
    <SelectContent>
      <SelectGroup>
        <SelectLabel>管理者のロール</SelectLabel>
        <SelectItem value="owner">最上位管理者</SelectItem>
        <SelectItem value="admin" disabled>
          管理者
        </SelectItem>
        <SelectItem value="operator">運営者</SelectItem>
      </SelectGroup>
      <SelectSeparator />
      <SelectItem value="viewer">閲覧者</SelectItem>
    </SelectContent>
  );
}

function renderRoleSelect(
  trigger: {
    readonly invalid?: boolean;
    readonly size?: SelectTriggerSize;
  } = {},
) {
  return function RoleSelect(args: Meta<typeof Select>['args']) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Label htmlFor="role">ロール</Label>
        <Select {...args}>
          <SelectTrigger
            id="role"
            aria-invalid={trigger.invalid}
            size={trigger.size}
          >
            <SelectValue placeholder="ロールを選択" />
          </SelectTrigger>
          <RoleOptions />
        </Select>
      </div>
    );
  };
}

const meta = {
  title: '基本部品/Select',
  component: Select,
  args: { onValueChange: fn() },
  render: renderRoleSelect(),
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selected: Story = {
  args: { defaultValue: 'operator' },
};

export const Open: Story = {
  args: { defaultValue: 'operator', defaultOpen: true },
  parameters: {
    // 開いた一覧の外側はaria-hiddenになりフォーカスも一覧の中に閉じ込められるが、検査はダイアログ以外の重ねた表示を判定できず外側の開いた元の要素を違反に数えるため、開いた一覧だけを検査する
    a11y: { context: '[data-slot="select-content"]' },
  },
};

export const Small: Story = {
  render: renderRoleSelect({ size: 'sm' }),
};

export const Invalid: Story = {
  render: renderRoleSelect({ invalid: true }),
};

export const Disabled: Story = {
  args: { disabled: true },
};
