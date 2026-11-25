import { type SQL, sql } from 'drizzle-orm';

import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';

// 退会とプロダクトの論理削除で終わった広告は表示停止の日数分も返金しない。精算済みの結果は上書きしない
export function waivedStopRefundStatus(): SQL<'not_needed'> {
  return sql<'not_needed'>`case when ${sponsorships.stopRefundStatus} = 'none' then 'not_needed' else ${sponsorships.stopRefundStatus} end`;
}
