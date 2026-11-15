import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { RouteAnnouncer } from './route-announcer.tsx';

const meta = {
  title: '文書の外枠/RouteAnnouncer',
  component: RouteAnnouncer,
  render: () => (
    <>
      <p className="text-sm text-muted-foreground">
        画面遷移の後に移動先のタイトルを支援技術へ読み上げさせる領域です。画面には表示しません。
      </p>
      <RouteAnnouncer />
    </>
  ),
} satisfies Meta<typeof RouteAnnouncer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
