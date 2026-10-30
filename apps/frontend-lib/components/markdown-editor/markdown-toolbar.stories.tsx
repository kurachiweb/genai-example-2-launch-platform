import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import type { EditorAction, EditorController } from './editor-controller.ts';
import { MarkdownToolbar } from './markdown-toolbar.tsx';

const EDITABLE_ID = 'markdown-toolbar-story-body';

const controller: EditorController = {
  run: fn(),
  currentLink: fn(() => undefined),
  applyLink: fn(),
  replaceMarkdown: fn(),
  readMarkdown: fn(() => ''),
  focus: fn(),
};

const meta = {
  title: 'マークダウン/MarkdownToolbar',
  component: MarkdownToolbar,
  args: {
    controller,
    activeActions: new Set<EditorAction>(),
    controlsId: EDITABLE_ID,
    onRequestLink: fn(),
  },
  render: (args) => (
    <div className="rounded-xl border bg-card text-card-foreground">
      <MarkdownToolbar {...args} className="border-b px-2 py-1.5" />
      <p id={EDITABLE_ID} className="min-h-24 p-3 text-sm">
        ツールバーの操作は、この編集領域の選択範囲に書式を適用します。
      </p>
    </div>
  ),
} satisfies Meta<typeof MarkdownToolbar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ActiveFormats: Story = {
  args: {
    activeActions: new Set<EditorAction>(['heading', 'bold', 'bulletList']),
  },
};

export const Loading: Story = {
  args: { controller: undefined },
};

export const Preview: Story = {
  args: { inactive: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};
