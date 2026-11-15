import type { Meta, StoryObj } from '@storybook/tanstack-react';

import {
  createDocumentFile,
  createImageFile,
  createSvgFile,
} from '../../test/media-files.ts';
import {
  type FileSelectionItem,
  FileSelectionList,
} from './file-selection-list.tsx';

const MEGABYTE = 1024 * 1024;

const meta = {
  title: 'メディア/FileSelectionList',
  component: FileSelectionList,
  args: { items: [] },
  loaders: [
    async (): Promise<{ readonly items: readonly FileSelectionItem[] }> => ({
      items: [
        {
          file: await createImageFile('screenshot.png', 'image/png', {
            width: 1280,
            height: 800,
          }),
        },
        {
          file: await createImageFile('photo.jpg', 'image/jpeg', {
            width: 600,
            height: 900,
          }),
        },
        { file: createSvgFile('logo.svg') },
      ],
    }),
  ],
  render: (args, { loaded }) => (
    <div className="max-w-md">
      <FileSelectionList
        {...args}
        items={
          args.items.length > 0
            ? args.items
            : (loaded['items'] as readonly FileSelectionItem[])
        }
      />
    </div>
  ),
} satisfies Meta<typeof FileSelectionList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Images: Story = {};

export const Attachments: Story = {
  args: {
    items: [
      {
        file: createDocumentFile(
          'specification.pdf',
          'application/pdf',
          Math.round(3.4 * MEGABYTE),
        ),
      },
      { file: createDocumentFile('notes.txt', 'text/plain', 2048) },
    ],
  },
};

export const WithStatus: Story = {
  args: {
    items: [
      { file: createSvgFile('logo.svg'), status: 'アップロード済み' },
      {
        file: createDocumentFile(
          `${'very-long-file-name-'.repeat(6)}.pdf`,
          'application/pdf',
          512,
        ),
        status: '送信中',
      },
    ],
  },
};
