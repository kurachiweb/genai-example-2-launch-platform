import { z } from 'zod';

import { AUDIT_REASON_MAX } from '../../../../common-lib/admin/admin-input-rules.ts';
import { SPONSORSHIP_MAX_DAYS } from '../../../../common-lib/sponsorship/sponsorship-period.ts';
import { countGraphemes } from '../../../../common-lib/text/graphemes.ts';
import { countBusinessDaysInclusive } from '../../../../common-lib/time/business-date-arithmetic.ts';
import { type AnyEmailKind, defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema as linkUrl } from './link-url.ts';

const text = z.string().min(1);

const days = z.number().int().min(1).max(SPONSORSHIP_MAX_DAYS);

// 金額は送る側が「$12.34」の表記か、残りの全額で依頼したときの「残りの全額」にして渡す
const refundNotice = z.object({ days, amount: text });

const noticeBaseShape = {
  nickname: text,
  productName: text,
  tierLabel: text,
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  days,
  listUrl: linkUrl,
};

interface NoticePeriod {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly days: number;
}

// 本文に載せる日数と掲載期間が食い違ったまま送らないよう、両端を含む日数と一致することを確かめる
function daysMatchPeriod({ startsOn, endsOn, days }: NoticePeriod): boolean {
  try {
    return countBusinessDaysInclusive(startsOn, endsOn) === days;
  } catch {
    return false;
  }
}

const PERIOD_MISMATCH = {
  message: '日数は掲載期間の両端を含む日数で指定してください',
  path: ['days'],
};

const startNoticeInput = z
  .object(noticeBaseShape)
  .refine(daysMatchPeriod, PERIOD_MISMATCH);

const endNoticeInput = z
  .object({ ...noticeBaseShape, stopRefund: refundNotice.nullable() })
  .refine(daysMatchPeriod, PERIOD_MISMATCH);

const terminationNoticeInput = z
  .object({
    ...noticeBaseShape,
    terminatedOn: z.iso.date(),
    // 管理画面の理由の上限は書記素で数えるため、絵文字を含む理由も同じ数え方で受け付ける
    reason: text.refine((value) => countGraphemes(value) <= AUDIT_REASON_MAX, {
      message: `理由は${String(AUDIT_REASON_MAX)}文字以内で指定してください`,
    }),
    legalUrl: linkUrl,
    terminationRefund: refundNotice.nullable(),
    stopRefund: refundNotice.nullable(),
  })
  .refine(daysMatchPeriod, PERIOD_MISMATCH)
  // YYYY-MM-DDの固定長のため、文字列の大小が日付の前後と一致する
  .refine((input) => input.terminatedOn <= input.endsOn, {
    message: '強制終了日は掲載終了日以前の日付で指定してください',
    path: ['terminatedOn'],
  });

export type SponsorshipRefundNotice = z.infer<typeof refundNotice>;

export type SponsorshipStartNoticeInput = z.infer<typeof startNoticeInput>;

export type SponsorshipEndNoticeInput = z.infer<typeof endNoticeInput>;

export type SponsorshipTerminationNoticeInput = z.infer<
  typeof terminationNoticeInput
>;

export const SPONSORSHIP_START_NOTICE_EMAIL = defineEmailKind({
  name: 'sponsorship.start-notice',
  category: 'transactional',
  inputSchema: startNoticeInput,
});

export const SPONSORSHIP_END_NOTICE_EMAIL = defineEmailKind({
  name: 'sponsorship.end-notice',
  category: 'transactional',
  inputSchema: endNoticeInput,
});

export const SPONSORSHIP_TERMINATION_NOTICE_EMAIL = defineEmailKind({
  name: 'sponsorship.termination-notice',
  category: 'transactional',
  inputSchema: terminationNoticeInput,
});

export const SPONSORSHIP_EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  SPONSORSHIP_START_NOTICE_EMAIL,
  SPONSORSHIP_END_NOTICE_EMAIL,
  SPONSORSHIP_TERMINATION_NOTICE_EMAIL,
]);
