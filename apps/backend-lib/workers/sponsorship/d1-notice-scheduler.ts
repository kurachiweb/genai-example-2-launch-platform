import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { NoticeScheduler } from '../../core/sponsorship/ports.ts';
import type { BusinessDate } from '../../core/time/business-time.ts';
import type { Clock } from '../../core/time/clock.ts';

// 統計の無いD1では状態の等号で絞れる表示の索引が選ばれ、決済済みの全件を読むため、終了日の部分索引を指定する。部分索引の条件は'paid'・'none'をリテラルで書かないと使えず、使えない条件に変えると実行時のエラーになる
const UNSETTLED_END_INDEX = 'sponsorships_unsettled_end_idx';

@injectable()
export class D1NoticeScheduler implements NoticeScheduler {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async markDue(today: BusinessDate): Promise<void> {
    const at = this.clock.now();
    const dueEnds = sql`(select ${sponsorships.id} from ${sponsorships} indexed by ${sql.identifier(UNSETTLED_END_INDEX)} where ${sponsorships.state} = 'paid' and ${sponsorships.deletedAt} is null and ${sponsorships.endNotice} = 'none' and ${sponsorships.stopRefundStatus} <> 'none' and ${sponsorships.endsOn} < ${today})`;
    await this.db.batch([
      this.db
        .update(sponsorships)
        .set({ startNotice: 'pending', updatedAt: at })
        .where(
          and(
            eq(sponsorships.state, 'paid'),
            isNull(sponsorships.deletedAt),
            eq(sponsorships.startsOn, today),
            eq(sponsorships.startNotice, 'none'),
          ),
        ),
      this.db
        .update(sponsorships)
        .set({ endNotice: 'pending', updatedAt: at })
        .where(inArray(sponsorships.id, dueEnds)),
    ]);
  }

  async hasPending(): Promise<boolean> {
    const rows = await this.db
      .select({ id: sponsorships.id })
      .from(sponsorships)
      .where(
        or(
          eq(sponsorships.startNotice, 'pending'),
          eq(sponsorships.endNotice, 'pending'),
          eq(sponsorships.terminationNotice, 'pending'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
