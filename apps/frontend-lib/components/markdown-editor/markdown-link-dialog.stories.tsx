import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn, screen } from 'storybook/test';

import type { EditorController, EditorLink } from './editor-controller.ts';
import { MarkdownLinkDialog } from './markdown-link-dialog.tsx';

const controllerWith = (link: EditorLink | undefined): EditorController => ({
  run: fn(),
  currentLink: fn(() => link),
  applyLink: fn(),
  replaceMarkdown: fn(),
  readMarkdown: fn(() => ''),
  focus: fn(),
});

const meta = {
  title: 'マークダウン/MarkdownLinkDialog',
  component: MarkdownLinkDialog,
  args: {
    open: true,
    controller: controllerWith(undefined),
    onOpenChange: fn(),
  },
} satisfies Meta<typeof MarkdownLinkDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const NewLink: Story = {};

export const ExistingLink: Story = {
  args: {
    controller: controllerWith({ href: 'https://client.example/rules' }),
  },
};

export const FormatError: Story = {
  play: async ({ userEvent }) => {
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'URL' }),
      'client.example/rules',
    );
    await userEvent.click(screen.getByRole('button', { name: '設定' }));
  },
};
