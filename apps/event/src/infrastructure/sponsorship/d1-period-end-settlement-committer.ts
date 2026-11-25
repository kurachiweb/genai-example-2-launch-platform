import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import type { SponsorshipRecord } from '../../../lib/core/sponsorship/ports.ts';
import {
  refundOutcomeOf,
  type RefundSettlement,
} from '../../../lib/workers/sponsorship/refund-settlement.ts';
import type {
  PeriodEndSettlementCommitter,
  PeriodEndSettlementResult,
} from '../../application/sponsorship/ports.ts';

// 精算の前進の文だけが起こす違反。D1は`D1_ERROR: NOT NULL constraint failed: sponsorships.stop_refund_status: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ
const NOT_SETTLEABLE_PATTERN =
  /NOT NULL constraint failed: sponsorships\.stop_refund_status(?::|$)/u;

const SKIPPED: PeriodEndSettlementResult = Object.freeze({ kind: 'skipped' });

function isNotSettleable(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (NOT_SETTLEABLE_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}

@injectable()
export class D1PeriodEndSettlementCommitter implements PeriodEndSettlementCommitter {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(SPONSORSHIP_PLATFORM_TYPES.RefundSettlement)
    private readonly settlement: RefundSettlement,
  ) {}

  async settle(
    record: SponsorshipRecord,
    at: Date,
  ): Promise<PeriodEndSettlementResult> {
    const plan = await this.settlement.planPeriodEnd(record);
    try {
      // 同時の精算・強制終了・退会・プロダクトの論理削除と競合したとき、前進の文の違反が最初の失敗になるよう先頭に置く
      await this.db.batch([
        this.settlement.periodEndStatement(record, plan, at, this.db),
        ...plan.statements,
      ]);
    } catch (error) {
      if (isNotSettleable(error)) {
        return SKIPPED;
      }
      throw error;
    }
    // 返金済み・拒否の知らせも送るため、依頼しない計画も渡す
    await this.settlement.dispatch([plan]);
    return { kind: 'settled', displayStop: refundOutcomeOf(plan) };
  }
}
