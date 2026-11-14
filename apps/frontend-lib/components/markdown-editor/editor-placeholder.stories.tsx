import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { renderMarkdown } from '../../../common-lib/markdown/render-markdown.ts';
import { EditorPlaceholder } from './editor-placeholder.tsx';

const rendered = renderMarkdown(
  [
    '## ローンチの感想',
    '',
    '**投票**の仕組みが分かりやすく、[要項](https://client.example/rules)も読みやすいです。',
    '',
    '- 良かった点',
    '- 気になった点',
  ].join('\n'),
  {
    siteOrigin: 'https://client.example',
    externalLinkRel: ['noopener', 'ugc'],
    idScope: 'preview',
  },
);

const meta = {
  title: 'マークダウン/EditorPlaceholder',
  component: EditorPlaceholder,
  args: {
    state: 'loading',
    rendered,
    placeholder: 'コメントを入力してください',
    onRetry: fn(),
  },
  render: (args) => (
    <div className="max-w-xl rounded-md border border-input bg-card text-card-foreground">
      <EditorPlaceholder {...args} />
    </div>
  ),
} satisfies Meta<typeof EditorPlaceholder>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Loading: Story = {};

export const LoadingEmpty: Story = {
  args: { rendered: undefined },
};

export const Failed: Story = {
  args: { state: 'failed' },
};
