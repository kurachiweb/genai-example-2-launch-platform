import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { HighlightedText } from './highlighted-text.tsx';

const meta = {
  title: '検索/HighlightedText',
  component: HighlightedText,
  args: {
    text: 'Launch Stadium 投票で競い合うローンチの大会',
    terms: ['launch', '投票'],
  },
  argTypes: {
    terms: { control: 'object' },
  },
  // 検索結果のタグラインと同じく、控えめな文字色の段落の中に置く
  decorators: [
    (Story) => (
      <p className="text-sm text-muted-foreground">
        <Story />
      </p>
    ),
  ],
} satisfies Meta<typeof HighlightedText>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WordPrefixOnly: Story = {
  args: {
    text: 'Relaunch Launcher タスク管理ツール',
    terms: ['launch', '管理'],
  },
};

export const FullWidthText: Story = {
  args: {
    text: 'ＬＡＵＮＣＨ　ＳＴＡＤＩＵＭ ｶﾀｶﾅ',
    terms: ['launch', 'カタカナ'],
  },
};

export const FullWidthTerms: Story = {
  args: {
    text: 'Launch Stadium カタカナ',
    terms: ['ＬＡＵＮＣＨ', 'ｶﾀｶﾅ'],
  },
};

export const Diacritics: Story = {
  args: {
    text: 'Café Résumé Naïve',
    terms: ['cafe', 'resume', 'NAIVE'],
  },
};

export const DiacriticsInTerms: Story = {
  args: {
    text: 'Cafe Resume Naive',
    terms: ['café', 'résumé'],
  },
};

export const NoMatch: Story = {
  args: {
    terms: ['upvote'],
  },
};
