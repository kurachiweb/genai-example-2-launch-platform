import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { createSvgFile } from '../../test/media-files.ts';
import { FileDropZone } from './file-drop-zone.tsx';

const meta = {
  title: 'メディア/FileDropZone',
  component: FileDropZone,
  args: {
    label: '画像を選択',
    accept: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ],
    onSelect: fn(),
  },
  render: (args) => (
    <div className="max-w-md">
      <FileDropZone {...args} />
    </div>
  ),
} satisfies Meta<typeof FileDropZone>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Multiple: Story = {
  args: {
    label: 'ファイルを選択',
    accept: ['image/jpeg', 'image/png', 'application/pdf', 'text/plain'],
    multiple: true,
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Dragging: Story = {
  play: ({ canvasElement }) => {
    const zone = canvasElement.querySelector('[data-slot="file-drop-zone"]');
    const transfer = new DataTransfer();
    transfer.items.add(createSvgFile('logo.svg'));
    zone?.dispatchEvent(
      new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  },
};
