import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { useState } from 'react';

import { InquiryAutoRefreshSwitch } from './inquiry-auto-refresh-switch.tsx';

const meta = {
  title: '問い合わせ/InquiryAutoRefreshSwitch',
  component: InquiryAutoRefreshSwitch,
  args: { checked: true, onCheckedChange: () => undefined },
} satisfies Meta<typeof InquiryAutoRefreshSwitch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const On: Story = {};

export const Off: Story = {
  args: { checked: false },
};

function InteractiveSwitch() {
  const [checked, setChecked] = useState(true);
  return (
    <InquiryAutoRefreshSwitch checked={checked} onCheckedChange={setChecked} />
  );
}

export const Interactive: Story = {
  render: () => <InteractiveSwitch />,
};
