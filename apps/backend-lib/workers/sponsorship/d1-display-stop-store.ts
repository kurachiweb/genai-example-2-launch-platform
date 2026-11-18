import { and, asc, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { sponsorshipDisplayStops } from '../../../db/schema/sponsorship/sponsorship-display-stops.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  DisplayStopInterval,
  DisplayStopStore,
  DisplayStopSubject,
} from '../../core/sponsorship/ports.ts';
import { displayStopSubjectIs } from './display-stop-subject.ts';

@injectable()
export class D1DisplayStopStore implements DisplayStopStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listOverlapping(input: {
    readonly productId: string;
    readonly userId: string;
    readonly from: Date;
    readonly to: Date;
  }): Promise<readonly DisplayStopInterval[]> {
    return this.db
      .select({
        startedAt: sponsorshipDisplayStops.startedAt,
        endedAt: sponsorshipDisplayStops.endedAt,
      })
      .from(sponsorshipDisplayStops)
      .where(
        and(
          or(
            displayStopSubjectIs({
              kind: 'product',
              productId: input.productId,
            }),
            displayStopSubjectIs({ kind: 'user', userId: input.userId }),
          ),
          lt(sponsorshipDisplayStops.startedAt, input.to),
          or(
            isNull(sponsorshipDisplayStops.endedAt),
            gt(sponsorshipDisplayStops.endedAt, input.from),
          ),
        ),
      )
      .orderBy(
        asc(sponsorshipDisplayStops.startedAt),
        asc(sponsorshipDisplayStops.id),
      );
  }

  async deleteSubject(subject: DisplayStopSubject): Promise<void> {
    await this.db
      .delete(sponsorshipDisplayStops)
      .where(displayStopSubjectIs(subject));
  }

  async deleteEndedBefore(cutoff: Date, limit: number): Promise<number> {
    const ended = this.db
      .select({ id: sponsorshipDisplayStops.id })
      .from(sponsorshipDisplayStops)
      .where(lt(sponsorshipDisplayStops.endedAt, cutoff))
      .orderBy(
        asc(sponsorshipDisplayStops.endedAt),
        asc(sponsorshipDisplayStops.id),
      )
      .limit(limit);
    const deleted = await this.db
      .delete(sponsorshipDisplayStops)
      .where(inArray(sponsorshipDisplayStops.id, ended))
      .returning({ id: sponsorshipDisplayStops.id });
    return deleted.length;
  }
}
