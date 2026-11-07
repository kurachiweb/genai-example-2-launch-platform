import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { type ReactNode, use, useId } from 'react';

import { RecoverableSlot } from './recoverable-slot.tsx';

const SECTION_TITLE = '問い合わせカテゴリ';

function RenderedSection() {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-lg font-semibold">
        {SECTION_TITLE}
      </h2>
      <p>区画の部品が取得して描いた本文。</p>
    </section>
  );
}

// 再試行のたびに描画をやり直しても失敗し続け、失敗の表示を保つ
function FailingSection(): never {
  throw new Error('区画の描画の失敗');
}

const NEVER_RESOLVED = new Promise<void>(() => undefined);

function SuspendingSection() {
  use(NEVER_RESOLVED);
  return <RenderedSection />;
}

// 区画の部品が描けない読み込み中と失敗の間だけ見出しを補う
function SectionFallback({ children }: { readonly children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} tabIndex={-1} className="text-lg font-semibold">
        {SECTION_TITLE}
      </h2>
      {children}
    </section>
  );
}

const withSectionFallback = (content: ReactNode) => (
  <SectionFallback>{content}</SectionFallback>
);

const meta = {
  title: '状態表示/RecoverableSlot',
  component: RecoverableSlot,
  args: {
    contactAvailable: true,
    contactHref: '/contact',
    className: 'rounded-sm',
    children: <RenderedSection />,
  },
} satisfies Meta<typeof RecoverableSlot>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  args: { children: <SuspendingSection /> },
};

export const LoadingWithFrame: Story = {
  args: { children: <SuspendingSection />, frame: withSectionFallback },
};

export const Failed: Story = {
  args: { children: <FailingSection /> },
};

export const FailedWithoutContact: Story = {
  args: {
    children: <FailingSection />,
    contactAvailable: false,
    contactHref: undefined,
  },
};

export const FailedWithFrame: Story = {
  args: { children: <FailingSection />, frame: withSectionFallback },
};
