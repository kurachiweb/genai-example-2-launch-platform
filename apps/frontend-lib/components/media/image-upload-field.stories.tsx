import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn, userEvent } from 'storybook/test';

import { createSvgFile } from '../../test/media-files.ts';
import {
  installStoryUploadEndpoint,
  type StoryUploadOutcome,
} from '../../test/story-upload-endpoint.ts';
import { ImageUploadField } from './image-upload-field.tsx';

const uploadOutcome = (outcome: StoryUploadOutcome) => (): (() => void) =>
  installStoryUploadEndpoint(outcome);

const uploadSvg = async ({
  canvasElement,
}: {
  readonly canvasElement: HTMLElement;
}): Promise<void> => {
  const input =
    canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
  if (input !== null) {
    await userEvent.upload(input, createSvgFile('logo.svg'));
  }
};

const meta = {
  title: 'メディア/ImageUploadField',
  component: ImageUploadField,
  args: {
    label: '画像を選択',
    constraints: {
      purpose: 'product-logo',
      allowedTypes: [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
      ],
      maxBytes: 512_000,
      subjectLabel: 'ロゴ',
    },
    edit: { aspect: 1, maxLongSide: 512 },
    contactAvailable: true,
    onUploaded: fn(),
  },
  beforeEach: uploadOutcome('success'),
  render: (args) => (
    <div className="max-w-md">
      <ImageUploadField {...args} />
    </div>
  ),
} satisfies Meta<typeof ImageUploadField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Uploaded: Story = {
  play: uploadSvg,
};

export const MultipleScreenshots: Story = {
  args: {
    label: 'スクリーンショットを選択',
    constraints: {
      purpose: 'product-screenshot',
      allowedTypes: ['image/jpeg', 'image/png'],
      maxBytes: 5_242_880,
      subjectLabel: 'スクリーンショット',
      maxCount: 20,
      maxTotalBytes: 20_971_520,
    },
    edit: { aspect: 16 / 9, maxLongSide: 1920 },
    multiple: true,
  },
};

export const Unavailable: Story = {
  beforeEach: uploadOutcome('unavailable'),
  play: uploadSvg,
};

export const Rejected: Story = {
  beforeEach: uploadOutcome('rejected'),
  play: uploadSvg,
};

export const UnexpectedWithoutContact: Story = {
  args: { contactAvailable: false },
  beforeEach: uploadOutcome('unexpected'),
  play: uploadSvg,
};

export const Disabled: Story = {
  args: { disabled: true },
};
