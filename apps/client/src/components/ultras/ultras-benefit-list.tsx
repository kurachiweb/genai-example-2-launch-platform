import { useId } from 'react';

import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import { ultrasBenefitNotesOf } from '../../../common-lib/ultras/checkout-notes.ts';
import {
  ULTRAS_BENEFITS,
  ULTRAS_BENEFITS_TITLE,
  ULTRAS_RENEWAL_TITLE,
} from './ultras-messages.ts';

export interface UltrasBenefitListProps {
  readonly amount: MinorUnitAmount | null;
}

const HEADING_CLASS_NAME = 'text-base font-extrabold';

const LIST_CLASS_NAME = 'list-disc space-y-1 pl-5 text-sm';

// 料金ページの区画とプラン管理画面の区画はどちらもh2の見出しを描くため、その1段下のh3で描く
export function UltrasBenefitList({ amount }: UltrasBenefitListProps) {
  const benefitsId = useId();
  const renewalId = useId();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 id={benefitsId} className={HEADING_CLASS_NAME}>
          {ULTRAS_BENEFITS_TITLE}
        </h3>
        <ul aria-labelledby={benefitsId} className={LIST_CLASS_NAME}>
          {ULTRAS_BENEFITS.map((benefit) => (
            <li key={benefit}>{benefit}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h3 id={renewalId} className={HEADING_CLASS_NAME}>
          {ULTRAS_RENEWAL_TITLE}
        </h3>
        <ul aria-labelledby={renewalId} className={LIST_CLASS_NAME}>
          {ultrasBenefitNotesOf(amount).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
