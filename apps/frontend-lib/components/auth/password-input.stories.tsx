import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Label } from '../ui/label/label.tsx';
import { PasswordInput } from './password-input.tsx';

const meta = {
  title: '認証/PasswordInput',
  component: PasswordInput,
  args: {
    id: 'password',
    autoComplete: 'current-password',
    defaultValue: ['correct', 'horse', 'battery', 'staple'].join(' '),
  },
  render: (args) => (
    <div className="flex max-w-sm flex-col gap-2">
      <Label htmlFor={args.id}>パスワード</Label>
      <PasswordInput {...args} />
    </div>
  ),
} satisfies Meta<typeof PasswordInput>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Visible: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole('button', { name: 'パスワードを表示' }),
    );
  },
};

export const Empty: Story = {
  args: { autoComplete: 'new-password', defaultValue: '' },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true },
};

export const Disabled: Story = {
  args: { disabled: true },
};
