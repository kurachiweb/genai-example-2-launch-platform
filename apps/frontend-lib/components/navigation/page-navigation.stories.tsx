import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { PageNavigation } from './page-navigation.tsx';

const meta = {
  title: '導線/PageNavigation',
  component: PageNavigation,
  args: {
    label: 'ページ送り',
    hasPrevious: true,
    hasNext: true,
    settled: true,
    onPrevious: fn(),
    onNext: fn(),
  },
} satisfies Meta<typeof PageNavigation>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FirstPage: Story = {
  args: { hasPrevious: false },
};

export const Loading: Story = {
  args: { settled: false },
};
