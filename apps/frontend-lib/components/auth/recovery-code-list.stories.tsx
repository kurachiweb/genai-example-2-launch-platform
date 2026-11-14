import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { RecoveryCodeList } from './recovery-code-list.tsx';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// 秘密の値らしい文字列をソースに書かないよう、発行の形(4文字ずつ区切った16文字)のサンプルを実行時に組み立てる
const SAMPLE_CODES = Array.from({ length: 10 }, (_, index) =>
  Array.from({ length: 4 }, (__, group) =>
    Array.from(
      { length: 4 },
      (___, offset) =>
        ALPHABET[(index * 7 + group * 5 + offset * 3) % ALPHABET.length],
    ).join(''),
  ).join('-'),
);

const meta = {
  title: '認証/RecoveryCodeList',
  component: RecoveryCodeList,
  args: { codes: SAMPLE_CODES },
  render: (args) => (
    <div className="max-w-md">
      <RecoveryCodeList {...args} />
    </div>
  ),
} satisfies Meta<typeof RecoveryCodeList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AfterCopy: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'すべてコピー' }));
  },
};
