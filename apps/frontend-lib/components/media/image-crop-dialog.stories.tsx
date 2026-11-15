import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { createDocumentFile, createImageFile } from '../../test/media-files.ts';
import { ImageCropDialog } from './image-crop-dialog.tsx';

const meta = {
  title: 'メディア/ImageCropDialog',
  component: ImageCropDialog,
  args: {
    file: undefined,
    edit: { aspect: 1, maxLongSide: 512 },
    onConfirm: fn(),
    onCancel: fn(),
  },
  loaders: [
    async (): Promise<{ readonly photo: File }> => ({
      photo: await createImageFile('photo.jpg', 'image/jpeg', {
        width: 1600,
        height: 1000,
      }),
    }),
  ],
  render: (args, { loaded }) => (
    <ImageCropDialog {...args} file={args.file ?? (loaded['photo'] as File)} />
  ),
} satisfies Meta<typeof ImageCropDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Square: Story = {};

export const Round: Story = {
  args: { edit: { aspect: 1, maxLongSide: 512, cropShape: 'round' } },
};

export const FreeAspect: Story = {
  args: { edit: { aspect: 'free', maxLongSide: 1920 } },
};

export const Unreadable: Story = {
  args: { file: createDocumentFile('broken.png', 'image/png', 16) },
};
