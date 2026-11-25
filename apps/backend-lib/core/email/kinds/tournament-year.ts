import { z } from 'zod';

import { YEAR_REFUND_REASONS } from '../../year-tournament/year-entry-rules.ts';
import { type AnyEmailKind, defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema as linkUrl } from './link-url.ts';

const text = z.string().min(1);

const yearEntryRefundInput = z.object({
  nickname: text,
  yearLabel: text,
  weekLabel: text,
  reason: z.enum(YEAR_REFUND_REASONS),
  billingUrl: linkUrl,
});

export type YearEntryRefundEmailInput = z.infer<typeof yearEntryRefundInput>;

export const TOURNAMENT_YEAR_ENTRY_REFUND_KIND = defineEmailKind({
  name: 'tournament-year.entry-refund',
  category: 'transactional',
  inputSchema: yearEntryRefundInput,
});

export const TOURNAMENT_YEAR_EMAIL_KINDS: readonly AnyEmailKind[] =
  Object.freeze([TOURNAMENT_YEAR_ENTRY_REFUND_KIND]);
