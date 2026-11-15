import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';

import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type { PricingSection } from '../../composition/pricing-sections.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import {
  LEGAL_NOTICE_HREF,
  PRICING_LEGAL_NOTICE_AFTER_LINK,
  PRICING_LEGAL_NOTICE_BEFORE_LINK,
  PRICING_LEGAL_NOTICE_LINK_LABEL,
  PRICING_PAGE_TITLE,
} from './pricing-messages.ts';

export interface PricingPageProps {
  readonly sections: readonly PricingSection[];
}

// 区画の部品は自分の見出しを描くため、見出しは部品が描けない読み込み中と失敗の間だけここで描く
function SectionFallback({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      {/* 再試行の後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        tabIndex={-1}
        className="rounded-sm text-2xl font-extrabold tracking-tight"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

// 登録された区画をorderの順に並べ、1つの区画の描画や取得の失敗はその区画の位置に留めて他の区画と法的通知へのリンクの表示を続ける
export function PricingPage({ sections }: PricingPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 py-10">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
        {PRICING_PAGE_TITLE}
      </h1>
      {sections
        .toSorted((a, b) => a.order - b.order)
        .map(({ id, title, component: Section }) => (
          <RecoverableSlot
            key={id}
            className="rounded-sm"
            contactAvailable={CLIENT_PROFILE.contactAvailable}
            contactHref={CONTACT_HREF}
            frame={(content) => (
              <SectionFallback title={title}>{content}</SectionFallback>
            )}
          >
            <Section />
          </RecoverableSlot>
        ))}
      <p className="text-sm text-muted-foreground">
        {PRICING_LEGAL_NOTICE_BEFORE_LINK}
        <Link to={LEGAL_NOTICE_HREF} className={INLINE_LINK_CLASS_NAME}>
          {PRICING_LEGAL_NOTICE_LINK_LABEL}
        </Link>
        {PRICING_LEGAL_NOTICE_AFTER_LINK}
      </p>
    </div>
  );
}
