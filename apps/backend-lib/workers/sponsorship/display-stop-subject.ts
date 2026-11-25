import { and, eq, type SQL, sql } from 'drizzle-orm';

import { sponsorshipDisplayStops } from '../../../db/schema/sponsorship/sponsorship-display-stops.ts';
import type { DisplayStopSubject } from '../../core/sponsorship/ports.ts';

export interface DisplayStopSubjectColumns {
  readonly kind: DisplayStopSubject['kind'];
  readonly id: string;
}

export function displayStopSubjectColumnsOf(
  subject: DisplayStopSubject,
): DisplayStopSubjectColumns {
  return subject.kind === 'product'
    ? { kind: 'product', id: subject.productId }
    : { kind: 'user', id: subject.userId };
}

export function displayStopSubjectIs(subject: DisplayStopSubject): SQL {
  const { kind, id } = displayStopSubjectColumnsOf(subject);
  return sql`${and(
    eq(sponsorshipDisplayStops.subjectKind, kind),
    eq(sponsorshipDisplayStops.subjectId, id),
  )}`;
}
