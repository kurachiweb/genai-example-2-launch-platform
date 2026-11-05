import { CircleCheckIcon } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

import {
  GUEST_COMPLETE_DESCRIPTION,
  GUEST_COMPLETE_TITLE,
} from './inquiry-contact-messages.ts';

// 押した送信のボタンはフォームごと消えるため、置き換えた表示の見出しへフォーカスを移して読み上げさせ、フォーカスを<body>へ落とさない
export function GuestInquiryComplete() {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-lg border border-border p-6"
    >
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="flex items-center gap-2 text-lg font-bold"
      >
        <CircleCheckIcon aria-hidden="true" className="size-5 shrink-0" />
        {GUEST_COMPLETE_TITLE}
      </h2>
      <p className="text-sm">{GUEST_COMPLETE_DESCRIPTION}</p>
    </section>
  );
}
