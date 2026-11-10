import { useId } from 'react';

import { ReserveLaunchLink } from '../product/reserve-launch-link.tsx';
import {
  LAUNCH_CTA_DESCRIPTION,
  LAUNCH_CTA_TITLE,
} from './launch-cta-messages.ts';

export interface LaunchCtaProps {
  readonly signedIn: boolean;
}

// 一覧の末尾に控えめに置く、ローンチの予約への導線
export function LaunchCta({ signedIn }: LaunchCtaProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-6 py-8 text-center"
    >
      <h2 id={headingId} className="font-bold">
        {LAUNCH_CTA_TITLE}
      </h2>
      <p className="text-sm text-muted-foreground">{LAUNCH_CTA_DESCRIPTION}</p>
      <ReserveLaunchLink signedIn={signedIn} className="mt-2" />
    </section>
  );
}
