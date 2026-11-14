import type { DeliveryEvent } from './delivery-event.ts';

export const SUPPRESSION_REASONS = [
  'hard_bounce',
  'complaint',
  'rejected',
] as const;

export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export interface SuppressionState {
  readonly lastReason: SuppressionReason;
  readonly lastEventAt: Date;
  readonly expiresAt: Date | null;
}

export type SuppressionEffect =
  | { readonly kind: 'suppress'; readonly state: SuppressionState }
  | {
      readonly kind: 'report';
      readonly category: 'sender-side-rejection' | 'delivery-failed';
      readonly reason: string;
    }
  | { readonly kind: 'log-only'; readonly category: 'soft-bounce' }
  | { readonly kind: 'ignore' };

export const REJECTION_SUPPRESSION_DAYS = 7;

export const UNLINKED_RETENTION_DAYS = 365;

export const SEND_RECORD_RETENTION_DAYS = 14;

const MILLISECONDS_PER_DAY = 86_400_000;

// 同時刻の契機の理由を一意に決め、合成を到着順に依存させないための順位
const REASON_STRENGTH: Readonly<Record<SuppressionReason, number>> = {
  complaint: 3,
  hard_bounce: 2,
  rejected: 1,
};

export function decideSuppressionEffect(
  event: DeliveryEvent,
): SuppressionEffect {
  switch (event.kind) {
    case 'hard-bounce':
      return suppress('hard_bounce', event.occurredAt, null);
    case 'complaint':
      return suppress('complaint', event.occurredAt, null);
    case 'rejected':
      return event.party === 'recipient'
        ? suppress(
            'rejected',
            event.occurredAt,
            new Date(
              event.occurredAt.getTime() +
                REJECTION_SUPPRESSION_DAYS * MILLISECONDS_PER_DAY,
            ),
          )
        : {
            kind: 'report',
            category: 'sender-side-rejection',
            reason: event.reason,
          };
    case 'failed':
      return {
        kind: 'report',
        category: 'delivery-failed',
        reason: event.reason,
      };
    case 'soft-bounce':
      return { kind: 'log-only', category: 'soft-bounce' };
    case 'ignored':
      return { kind: 'ignore' };
  }
}

export function mergeSuppression(
  existing: SuppressionState | undefined,
  incoming: SuppressionState,
): SuppressionState {
  if (existing === undefined) {
    return incoming;
  }
  const latest = isLaterTrigger(incoming, existing) ? incoming : existing;
  return {
    lastReason: latest.lastReason,
    lastEventAt: latest.lastEventAt,
    expiresAt: laterExpiry(existing.expiresAt, incoming.expiresAt),
  };
}

export function isSuppressionActive(
  state: SuppressionState,
  now: Date,
): boolean {
  return state.expiresAt === null || state.expiresAt.getTime() > now.getTime();
}

function suppress(
  lastReason: SuppressionReason,
  lastEventAt: Date,
  expiresAt: Date | null,
): SuppressionEffect {
  return { kind: 'suppress', state: { lastReason, lastEventAt, expiresAt } };
}

function isLaterTrigger(
  candidate: SuppressionState,
  current: SuppressionState,
): boolean {
  const difference =
    candidate.lastEventAt.getTime() - current.lastEventAt.getTime();
  if (difference !== 0) {
    return difference > 0;
  }
  return (
    REASON_STRENGTH[candidate.lastReason] > REASON_STRENGTH[current.lastReason]
  );
}

function laterExpiry(a: Date | null, b: Date | null): Date | null {
  if (a === null || b === null) {
    return null;
  }
  return a.getTime() >= b.getTime() ? a : b;
}
