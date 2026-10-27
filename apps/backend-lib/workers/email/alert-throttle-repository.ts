import { lte } from 'drizzle-orm';

import type { Database } from '../../../db/client.ts';
import { emailAlertThrottles } from '../../../db/schema/email/email-alert-throttles.ts';
import type { AlertThrottle } from '../../core/email/ports.ts';

export function createAlertThrottleRepository(db: Database): AlertThrottle {
  return {
    async tryAcquire(name, now, intervalSeconds) {
      const reportableUntil = new Date(now.getTime() - intervalSeconds * 1000);
      // 同時に呼ばれても真を返すのが1回だけになるよう、判定と更新を1つの文で行う。条件を満たさない競合時更新は行を返さない
      const acquired = await db
        .insert(emailAlertThrottles)
        .values({
          name,
          lastReportedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: emailAlertThrottles.name,
          set: { lastReportedAt: now, updatedAt: now },
          setWhere: lte(emailAlertThrottles.lastReportedAt, reportableUntil),
        })
        .returning({ name: emailAlertThrottles.name });
      return acquired.length > 0;
    },
  };
}
