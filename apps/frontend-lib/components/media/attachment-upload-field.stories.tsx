import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn, userEvent } from 'storybook/test';

import { createDocumentFile } from '../../test/media-files.ts';
import {
  installStoryUploadEndpoint,
  type StoryUploadOutcome,
} from '../../test/story-upload-endpoint.ts';
import { AttachmentUploadField } from './attachment-upload-field.tsx';

const KILOBYTE = 1024;

const uploadOutcome = (outcome: StoryUploadOutcome) => (): (() => void) =>
  installStoryUploadEndpoint(outcome);

const uploadDocuments = async ({
  canvasElement,
}: {
  readonly canvasElement: HTMLElement;
}): Promise<void> => {
  const input =
    canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
  if (input !== null) {
    await userEvent.upload(input, [
      createDocumentFile('guide.pdf', 'application/pdf', 120 * KILOBYTE),
      createDocumentFile('notes.txt', 'text/plain', 2 * KILOBYTE),
    ]);
  }
};

const meta = {
  title: 'メディア/AttachmentUploadField',
  component: AttachmentUploadField,
  args: {
    label: 'ファイルを選択',
    constraints: {
      purpose: 'inquiry-attachment',
      allowedTypes: [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        'application/pdf',
        'text/plain',
      ],
      maxBytes: 10_485_760,
      subjectLabel: '添付ファイル',
      maxCount: 5,
      maxTotalBytes: 20_971_520,
    },
    multiple: true,
    contactAvailable: true,
    onUploaded: fn(),
  },
  beforeEach: uploadOutcome('success'),
  render: (args) => (
    <div className="max-w-md">
      <AttachmentUploadField {...args} />
    </div>
  ),
} satisfies Meta<typeof AttachmentUploadField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Uploaded: Story = {
  play: uploadDocuments,
};

export const Unavailable: Story = {
  beforeEach: uploadOutcome('unavailable'),
  play: uploadDocuments,
};

export const UnexpectedWithoutContact: Story = {
  args: { contactAvailable: false },
  beforeEach: uploadOutcome('unexpected'),
  play: uploadDocuments,
};

export const Disabled: Story = {
  args: { disabled: true },
};
