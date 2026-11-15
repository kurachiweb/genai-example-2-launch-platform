import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { PrivateFileLink } from './private-file-link.tsx';

const meta = {
  title: 'メディア/PrivateFileLink',
  component: PrivateFileLink,
  args: {
    fileId: 'file-1',
    fileName: 'specification.pdf',
    byteSize: Math.round(3.4 * 1024 * 1024),
  },
} satisfies Meta<typeof PrivateFileLink>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongFileName: Story = {
  args: {
    fileName: `${'very-long-file-name-'.repeat(6)}.pdf`,
    byteSize: 512,
  },
  render: (args) => (
    <div className="max-w-48">
      <PrivateFileLink {...args} />
    </div>
  ),
};
