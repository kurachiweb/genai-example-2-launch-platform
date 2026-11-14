import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { ThemeToggle } from './theme-toggle.tsx';

const meta = {
  title: '文書の外枠/ThemeToggle',
  component: ThemeToggle,
} satisfies Meta<typeof ThemeToggle>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithTooltip: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole('button'));
  },
};
