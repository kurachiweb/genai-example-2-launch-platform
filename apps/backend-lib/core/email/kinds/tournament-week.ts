import { z } from 'zod';

import type { WeekRefundReason } from '../../week-tournament/week-entry-rules.ts';
import { type AnyEmailKind, defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema as linkUrl } from './link-url.ts';

const WEEK_REFUND_REASONS = Object.freeze([
  'entitlement_lost',
  'entitlement_suspended',
] as const satisfies readonly WeekRefundReason[]);

const text = z.string().min(1);

const weekEntryRefundInput = z.object({
  nickname: text,
  weekLabel: text,
  launchDate: z.iso.date(),
  reason: z.enum(WEEK_REFUND_REASONS),
  billingUrl: linkUrl,
});

export type WeekEntryRefundEmailInput = z.infer<typeof weekEntryRefundInput>;

export const TOURNAMENT_WEEK_ENTRY_REFUND_KIND = defineEmailKind({
  name: 'tournament-week.entry-refund',
  category: 'transactional',
  inputSchema: weekEntryRefundInput,
});

export const TOURNAMENT_WEEK_EMAIL_KINDS: readonly AnyEmailKind[] =
  Object.freeze([TOURNAMENT_WEEK_ENTRY_REFUND_KIND]);
