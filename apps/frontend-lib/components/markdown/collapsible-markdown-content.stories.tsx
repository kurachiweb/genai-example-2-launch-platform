import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { READ_MORE_LABEL } from '../../utilities/messages/markdown-messages.ts';
import { CollapsibleMarkdownContent } from './collapsible-markdown-content.tsx';
import type { MarkdownContentSize } from './markdown-content.tsx';
import { useMarkdownOptions } from './use-markdown-options.ts';
import { useRenderedMarkdown } from './use-rendered-markdown.ts';

interface CollapsibleMarkdownExampleProps {
  readonly markdown: string;
  readonly collapsedHeight: number;
  readonly size?: MarkdownContentSize;
  readonly isOnCard?: boolean;
}

// 表示場所と同じく描画した結果を渡し、カードの上に置く表示場所はぼかしの色をカードの背景色にそろえる
function CollapsibleMarkdownExample({
  markdown,
  collapsedHeight,
  size,
  isOnCard = false,
}: CollapsibleMarkdownExampleProps) {
  const options = useMarkdownOptions({ externalLinkRel: ['noopener', 'ugc'] });
  const rendered = useRenderedMarkdown(markdown, options);
  const content = (
    <CollapsibleMarkdownContent
      rendered={rendered}
      collapsedHeight={collapsedHeight}
      size={size}
      {...(isOnCard ? { fadeClassName: 'from-card' } : {})}
    />
  );
  return isOnCard ? (
    <div className="rounded-xl border bg-card p-6 text-card-foreground">
      {content}
    </div>
  ) : (
    content
  );
}

const PARAGRAPH =
  '作った製品を投稿して、投票で競い合います。指定の高さを超える本文は折りたたみ、続きを読む操作で全文を表示します。';

const PRODUCT_DESCRIPTION = [
  '## 製品の概要',
  '',
  PARAGRAPH,
  '',
  '### 主な機能',
  '',
  '- 1対1のマッチで投票数を競う',
  '- 投票の結果を毎日集計する',
  '- 製品のページから外部のサイトへ案内する',
  '',
  ...Array.from({ length: 6 }, () => [PARAGRAPH, '']).flat(),
  '詳しくは[製品のサイト](https://product.example/)を参照してください。',
].join('\n');

const BIO = [
  '個人で開発しているエンジニアです。',
  '',
  ...Array.from({ length: 5 }, () => [PARAGRAPH, '']).flat(),
  '連絡先は[ポートフォリオ](https://portfolio.example/)にあります。',
].join('\n');

const SHORT_BIO = '個人で開発しているエンジニアです。';

const meta = {
  title: 'マークダウン/CollapsibleMarkdownContent',
  component: CollapsibleMarkdownExample,
  args: {
    markdown: PRODUCT_DESCRIPTION,
    collapsedHeight: 480,
    size: 'base',
    isOnCard: false,
  },
  argTypes: {
    markdown: { control: 'text' },
    collapsedHeight: { control: { type: 'number', min: 0, step: 40 } },
    size: { control: 'inline-radio', options: ['sm', 'base'] },
    isOnCard: { control: 'boolean' },
  },
} satisfies Meta<typeof CollapsibleMarkdownExample>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Collapsed480: Story = {};

export const Collapsed240OnCard: Story = {
  args: { markdown: BIO, collapsedHeight: 240, size: 'sm', isOnCard: true },
};

export const Expanded: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole('button', { name: READ_MORE_LABEL }),
    );
  },
};

export const FitsWithinHeight: Story = {
  args: {
    markdown: SHORT_BIO,
    collapsedHeight: 240,
    size: 'sm',
    isOnCard: true,
  },
};

export const Dark: Story = {
  globals: { theme: 'dark' },
};
