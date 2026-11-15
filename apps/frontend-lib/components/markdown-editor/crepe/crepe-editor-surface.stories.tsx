import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import CrepeEditorSurface from './crepe-editor-surface.tsx';

const LABEL_ID = 'crepe-editor-surface-label';

const DESCRIPTION_ID = 'crepe-editor-surface-description';

const SAMPLE = [
  '## ローンチの概要',
  '',
  '作った製品を投稿して、**投票**で競い合います。日本語の句読点に隣接する**強調。**も解釈します。',
  '',
  '- 箇条書きの項目',
  '',
  '1. 番号付きの項目',
  '',
  '> 引用の文',
  '',
  '[要項](https://client.example/rules)と`インラインのコード`。',
  '',
  '| 項目 | 説明 |',
  '| --- | --- |',
  '| 投票 | 1日1回まで |',
].join('\n');

const meta = {
  title: 'マークダウン/CrepeEditorSurface',
  component: CrepeEditorSurface,
  args: {
    initialValue: SAMPLE,
    editableId: 'crepe-editor-surface',
    labelledBy: LABEL_ID,
    describedBy: DESCRIPTION_ID,
    invalid: false,
    disabled: false,
    placeholder: '本文を入力してください',
    onReady: fn(),
    onMarkdownChange: fn(),
    onActiveActionsChange: fn(),
    onBlur: fn(),
    onRequestLink: fn(),
  },
  render: (args) => (
    <div className="grid gap-2">
      <span id={LABEL_ID} className="text-sm font-medium">
        本文
      </span>
      <p id={DESCRIPTION_ID} className="text-sm text-muted-foreground">
        マークダウンで書けます。
      </p>
      <div className="rounded-md border border-input">
        <CrepeEditorSurface {...args} />
      </div>
    </div>
  ),
} satisfies Meta<typeof CrepeEditorSurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { initialValue: '' },
};

export const Invalid: Story = {
  args: { invalid: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};
