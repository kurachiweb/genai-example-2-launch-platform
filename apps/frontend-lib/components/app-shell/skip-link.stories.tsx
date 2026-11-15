import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { MAIN_CONTENT_ID } from './main-content.ts';
import { SkipLink } from './skip-link.tsx';

const meta = {
  title: '文書の外枠/SkipLink',
  component: SkipLink,
  render: () => (
    <>
      <SkipLink />
      <nav aria-label="グローバル" className="flex gap-4 text-sm">
        <a href="#ranking">ランキング</a>
        <a href="#products">プロダクト一覧</a>
      </nav>
      <main id={MAIN_CONTENT_ID} className="mt-6">
        <h1 className="text-lg font-bold">本文</h1>
        <p className="text-sm text-muted-foreground">
          Tabキーで最初にスキップリンクへフォーカスが移り、表示されます。
        </p>
      </main>
    </>
  ),
} satisfies Meta<typeof SkipLink>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Focused: Story = {
  play: async ({ userEvent }) => {
    await userEvent.tab();
  },
};
