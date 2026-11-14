import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Label } from '../label/label.tsx';
import { RadioGroup } from './radio-group.tsx';
import { RadioGroupItem } from './radio-group-item.tsx';

const PLANS = [
  { value: 'free', label: '無料プラン' },
  { value: 'standard', label: 'スタンダードプラン' },
  { value: 'premium', label: 'プレミアムプラン' },
] as const;

const meta = {
  title: '基本部品/RadioGroup',
  component: RadioGroup,
  args: { defaultValue: 'free', 'aria-label': 'プラン' },
  render: (args) => (
    <RadioGroup {...args}>
      {PLANS.map(({ value, label }) => (
        <div key={value} className="flex items-center gap-2">
          <RadioGroupItem id={`plan-${value}`} value={value} />
          <Label htmlFor={`plan-${value}`}>{label}</Label>
        </div>
      ))}
    </RadioGroup>
  ),
} satisfies Meta<typeof RadioGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledItem: Story = {
  render: (args) => (
    <RadioGroup {...args}>
      {PLANS.map(({ value, label }) => (
        <div key={value} className="flex items-center gap-2">
          <RadioGroupItem
            id={`plan-${value}`}
            value={value}
            disabled={value === 'premium'}
          />
          <Label htmlFor={`plan-${value}`}>{label}</Label>
        </div>
      ))}
    </RadioGroup>
  ),
};
