import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Button } from '../ui/button/button.tsx';
import { type NotifyKind, notify } from './notify.ts';
import { Toaster } from './toaster.tsx';

const SAMPLES: readonly (readonly [NotifyKind, string, string])[] = [
  ['success', '成功', 'プロダクトを投稿しました。'],
  ['info', 'お知らせ', '審査が終わるとプロダクトのページが公開されます。'],
  ['warning', '警告', '下書きは保存されていません。'],
  ['error', 'エラー', '投稿に失敗しました。時間をおいて再度お試しください。'],
];

const meta = {
  title: 'フィードバック/Toaster',
  component: Toaster,
  render: () => (
    <div className="flex flex-wrap gap-2">
      {SAMPLES.map(([kind, label, message]) => (
        <Button
          key={kind}
          variant="outline"
          onClick={() => {
            notify[kind](message);
          }}
        >
          {label}
        </Button>
      ))}
      <Toaster />
    </div>
  ),
} satisfies Meta<typeof Toaster>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SuccessToast: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: '成功' }));
  },
};

export const ErrorToast: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'エラー' }));
  },
};
