import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { InquiryAttachmentList } from './inquiry-attachment-list.tsx';

const meta = {
  title: '問い合わせ/InquiryAttachmentList',
  component: InquiryAttachmentList,
  args: {
    attachments: [
      {
        id: 'file-1',
        originalFileName: 'screenshot.png',
        contentType: 'image/png',
        byteSize: Math.round(1.5 * 1024 * 1024),
      },
      {
        id: 'file-2',
        originalFileName: 'specification.pdf',
        contentType: 'application/pdf',
        byteSize: 2048,
      },
      {
        id: 'file-3',
        originalFileName: 'error-log.txt',
        contentType: 'text/plain',
        byteSize: 512,
      },
    ],
  },
} satisfies Meta<typeof InquiryAttachmentList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongFileName: Story = {
  args: {
    attachments: [
      {
        id: 'file-1',
        originalFileName: `${'very-long-file-name-'.repeat(6)}.pdf`,
        contentType: 'application/pdf',
        byteSize: 512,
      },
    ],
  },
  render: (args) => (
    <div className="max-w-48">
      <InquiryAttachmentList {...args} />
    </div>
  ),
};
