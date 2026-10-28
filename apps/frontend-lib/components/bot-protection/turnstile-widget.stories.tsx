import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { TurnstileWidget } from './turnstile-widget.tsx';
import { useTurnstileToken } from './use-turnstile-token.ts';

interface TokenStatusExampleProps {
  readonly action?: string | undefined;
}

function TokenStatusExample({ action }: TokenStatusExampleProps) {
  const turnstile = useTurnstileToken();
  return (
    <div className="flex flex-col gap-2">
      <TurnstileWidget {...turnstile.widgetProps} action={action} />
      <p className="text-sm text-muted-foreground">
        判定の状態: {turnstile.status}
      </p>
    </div>
  );
}

const meta = {
  title: 'bot判定/TurnstileWidget',
  component: TurnstileWidget,
  args: {
    action: 'submit-product',
    status: 'idle',
    widgetRef: { current: undefined },
    onSuccess: fn(),
    onExpire: fn(),
    onError: fn(),
  },
  argTypes: {
    status: {
      control: 'select',
      options: ['idle', 'ready', 'expired', 'error'],
    },
  },
} satisfies Meta<typeof TurnstileWidget>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: ({ action }) => <TokenStatusExample action={action} />,
};

export const Ready: Story = {
  args: { status: 'ready' },
};

export const Failed: Story = {
  args: { status: 'error' },
};
