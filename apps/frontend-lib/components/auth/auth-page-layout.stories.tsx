import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Button } from '../ui/button/button.tsx';
import { AuthPageLayout } from './auth-page-layout.tsx';

const meta = {
  title: '認証/AuthPageLayout',
  component: AuthPageLayout,
  args: {
    title: 'ログイン',
    children: (
      <>
        <p className="text-sm text-muted-foreground">
          認証の画面のフォームを、題名の下の枠の中に置きます。
        </p>
        <Button type="button" className="self-start">
          ログインする
        </Button>
      </>
    ),
  },
} satisfies Meta<typeof AuthPageLayout>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
